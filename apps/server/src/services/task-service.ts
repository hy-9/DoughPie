import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";
import {
  COPY,
  type CreateTaskBody,
  type CursorPage,
  type MoveBody,
  type RecurrenceRule,
  type Task,
  type TaskQuery,
  type UpdateTaskBody,
  type createTaskBodySchema,
} from "@doughpie/shared";
import type { Db, Tx } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { lists, memberships, subtasks, tasks, type TaskRow } from "../models/schema.js";
import { writeEvent } from "./event-service.js";
import { insertNotification } from "./notification-service.js";
import { nextOccurrence } from "./recurrence.js";
import { gapInsertOrder, resequencedOrders } from "./sort-order.js";
import { requireCan } from "./workspace-guard.js";

/**
 * 任务业务流（P0-4/P0-10/P0-14/P0-15，backend.md §3/§4）。
 * - 写操作必须 If-Match: version 乐观锁（UPDATE ... WHERE version=N，flows.md §4），冲突 409
 * - 状态机四态自由流转（todo 直达 done 合法）；进 done 记 completed_at/by，离开 done 清空
 * - 重复任务：仅 done 触发下一实例（review 不算），每个原实例只生成一次后继
 * - 软删除：deleted_at 非空即过滤；恢复端点属 P1
 */

export interface TaskServiceDeps {
  db: Db;
}

export type TaskService = ReturnType<typeof createTaskService>;

interface SubtaskCounts {
  subtask_total: number;
  subtask_done: number;
}

const ZERO_COUNTS: SubtaskCounts = { subtask_total: 0, subtask_done: 0 };

function toTaskDto(row: TaskRow, counts: SubtaskCounts = ZERO_COUNTS): Task {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    list_id: row.listId,
    title: row.title,
    description: row.description,
    assignee_id: row.assigneeId,
    status: row.status,
    priority: row.priority,
    start_at: row.startAt?.toISOString() ?? null,
    due_at: row.dueAt?.toISOString() ?? null,
    remind_at: row.remindAt?.toISOString() ?? null,
    recurrence: row.recurrence,
    sort_order: row.sortOrder,
    version: row.version,
    completed_at: row.completedAt?.toISOString() ?? null,
    completed_by: row.completedBy,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...counts,
  };
}

/** ILIKE 模式转义：\ % _ 三个特殊字符（配合 ESCAPE '\'） */
function escapeIlike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 「当地今天」的 UTC 区间（taskQuerySchema.tz_offset 语义同 Date.getTimezoneOffset()：
 * UTC+8 = -480；当地时刻 = UTC - offset）。缺省 tz_offset=0 即 UTC 天。
 */
export function localTodayUtcRange(
  tzOffsetMinutes: number,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const DAY = 24 * 3600 * 1000;
  const localMs = now.getTime() - tzOffsetMinutes * 60000;
  const localDayStartMs = Math.floor(localMs / DAY) * DAY;
  const startUtcMs = localDayStartMs + tzOffsetMinutes * 60000;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + DAY) };
}

/** 优先级排序权重：high→none 映射 0→3（asc = 高优先在前） */
const PRIORITY_RANK_SQL = sql`case ${tasks.priority} when 'high' then 0 when 'mid' then 1 when 'low' then 2 else 3 end`;

/**
 * 游标 = (sort_key, id) 复合键，base64url(JSON)。key 序列化：时间为 ISO 串，due_at 可空为 null。
 * 采用键集（keyset）分页而非位移：并发写下不漏不重（PLAN.md §4 正确性只依赖游标）。
 */
function encodeTaskCursor(key: string | number | null, id: string): string {
  return Buffer.from(JSON.stringify([key, id]), "utf8").toString("base64url");
}

function decodeTaskCursor(cursor: string): { key: string | number | null; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (typeof parsed[0] === "string" || typeof parsed[0] === "number" || parsed[0] === null) &&
      typeof parsed[1] === "string"
    ) {
      return { key: parsed[0], id: parsed[1] };
    }
  } catch {
    // 落入统一 400
  }
  throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
}

/** 指定清单内排尾的 sort_order（空列取 1000） */
async function tailSortOrder(tx: Tx, listId: string): Promise<number> {
  const rows = await tx
    .select({ sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(and(eq(tasks.listId, listId), isNull(tasks.deletedAt)))
    .orderBy(desc(tasks.sortOrder))
    .limit(1);
  const tail = rows[0]?.sortOrder ?? null;
  const order = gapInsertOrder(tail, null);
  if (order === null) throw new ApiError(500, "INTERNAL", COPY.common.internal);
  return order;
}

/** assigned 通知（🔴 高，手动已读；自派不发——自己操作无需通知自己） */
async function notifyAssigned(
  tx: Tx,
  input: { task: TaskRow; assigneeId: string; actorId: string },
): Promise<void> {
  if (input.assigneeId === input.actorId) return;
  await insertNotification(tx, {
    userId: input.assigneeId,
    workspaceId: input.task.workspaceId,
    type: "assigned",
    entity: "task",
    entityId: input.task.id,
    actorId: input.actorId,
    payload: { task_id: input.task.id, list_id: input.task.listId, title: input.task.title },
  });
}

/** due_at 排序键：ISO 串，空值为 null（键集比较对 NULL 做显式感知） */
function dueAtKeyOf(row: TaskRow): string | null {
  return row.dueAt?.toISOString() ?? null;
}

/**
 * 建任务入参（zod input 型）：priority/interval 等 .default() 字段允许缺省，
 * 服务边界负责归一化——service 是一等公民（backend.md §7），routes/MCP 任一适配器行为一致。
 */
export type CreateTaskInput = z.input<typeof createTaskBodySchema>;

/** 归一化建任务入参：priority 缺省 none；recurrence.interval 缺省 1 */
function normalizeCreateInput(input: CreateTaskInput): CreateTaskBody {
  const recurrence: RecurrenceRule | null = input.recurrence
    ? { ...input.recurrence, interval: input.recurrence.interval ?? 1 }
    : null;
  return { ...input, priority: input.priority ?? "none", recurrence };
}

export function createTaskService(deps: TaskServiceDeps) {
  const { db } = deps;

  async function loadTask(taskId: string): Promise<TaskRow> {
    const row = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
    });
    if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    return row;
  }

  /** 负责人必须是本工作区成员（角色不限，viewer 也可被指派） */
  async function assertAssigneeMember(workspaceId: string, assigneeId: string): Promise<void> {
    const row = await db.query.memberships.findFirst({
      where: and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, assigneeId)),
      columns: { id: true },
    });
    if (!row) {
      throw new ApiError(400, "VALIDATION_FAILED", "负责人必须是工作区成员");
    }
  }

  /** 批量统计子任务进度（看板卡片 n/m）：一条分组查询，避免 N+1 */
  async function subtaskCountsMap(taskIds: string[]): Promise<Map<string, SubtaskCounts>> {
    const map = new Map<string, SubtaskCounts>();
    if (taskIds.length === 0) return map;
    const rows = await db
      .select({
        taskId: subtasks.taskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${subtasks.done})::int`,
      })
      .from(subtasks)
      .where(inArray(subtasks.taskId, taskIds))
      .groupBy(subtasks.taskId);
    for (const r of rows) map.set(r.taskId, { subtask_total: r.total, subtask_done: r.done });
    return map;
  }

  /** 单任务计数（详情/写操作返回路径） */
  async function subtaskCountsOf(taskId: string): Promise<SubtaskCounts> {
    const map = await subtaskCountsMap([taskId]);
    return map.get(taskId) ?? ZERO_COUNTS;
  }

  return {
    /** 新建任务：排尾；带 recurrence 必须有 due_at（契约决策，400 RECURRENCE_INVALID） */
    async createTask(userId: string, workspaceId: string, input: CreateTaskInput): Promise<Task> {
      const body = normalizeCreateInput(input);
      await requireCan(db, workspaceId, userId, "task.write");
      const list = await db.query.lists.findFirst({
        where: and(eq(lists.id, body.list_id), eq(lists.workspaceId, workspaceId)),
        columns: { id: true },
      });
      if (!list) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      if (body.assignee_id != null) await assertAssigneeMember(workspaceId, body.assignee_id);
      if (body.recurrence && !body.due_at) {
        throw new ApiError(400, "RECURRENCE_INVALID", COPY.task.recurrenceInvalid);
      }

      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(tasks)
          .values({
            id: uuidv7(),
            workspaceId,
            listId: body.list_id,
            title: body.title,
            description: body.description ?? null,
            assigneeId: body.assignee_id ?? null,
            priority: body.priority,
            startAt: body.start_at ? new Date(body.start_at) : null,
            dueAt: body.due_at ? new Date(body.due_at) : null,
            remindAt: body.remind_at ? new Date(body.remind_at) : null,
            recurrence: body.recurrence ?? null,
            sortOrder: await tailSortOrder(tx, body.list_id),
            createdBy: userId,
          })
          .returning();
        if (!row) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        await writeEvent(tx, {
          workspaceId,
          actorId: userId,
          type: "task.created",
          entity: "task",
          entityId: row.id,
          payload: {
            list_id: row.listId,
            title: row.title,
            status: row.status,
            priority: row.priority,
            assignee_id: row.assigneeId,
            due_at: row.dueAt?.toISOString() ?? null,
            version: row.version,
          },
        });
        if (row.assigneeId)
          await notifyAssigned(tx, { task: row, assigneeId: row.assigneeId, actorId: userId });
        return toTaskDto(row);
      });
    },

    async getTask(userId: string, taskId: string): Promise<Task> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "task.read");
      return toTaskDto(task, await subtaskCountsOf(taskId));
    },

    /**
     * 更新任务（If-Match 乐观锁）。状态/字段/跨清单移动统一入口。
     * 进 done 记完成人时间；离开 done 清空；重复任务在进 done 时同事务生成下一实例。
     */
    async updateTask(
      userId: string,
      taskId: string,
      ifMatch: number,
      body: UpdateTaskBody,
    ): Promise<Task> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "task.write");

      // 跨清单移动：目标清单必须在同一工作区
      if (body.list_id !== undefined && body.list_id !== task.listId) {
        const target = await db.query.lists.findFirst({
          where: and(eq(lists.id, body.list_id), eq(lists.workspaceId, task.workspaceId)),
          columns: { id: true },
        });
        if (!target) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      }
      // 负责人变更：必须是本工作区成员
      if (body.assignee_id !== undefined && body.assignee_id !== null) {
        await assertAssigneeMember(task.workspaceId, body.assignee_id);
      }
      // 重复规则与截止时间的联合校验（以更新后的最终状态为准）
      const finalRecurrence = body.recurrence !== undefined ? body.recurrence : task.recurrence;
      const finalDueAt =
        body.due_at !== undefined ? (body.due_at ? new Date(body.due_at) : null) : task.dueAt;
      if (finalRecurrence && !finalDueAt) {
        throw new ApiError(400, "RECURRENCE_INVALID", COPY.task.recurrenceInvalid);
      }

      const statusChanged = body.status !== undefined && body.status !== task.status;
      const enteringDone = statusChanged && body.status === "done";
      const leavingDone = statusChanged && task.status === "done";
      const listChanged = body.list_id !== undefined && body.list_id !== task.listId;
      const now = new Date();

      return db.transaction(async (tx) => {
        const set: Partial<typeof tasks.$inferInsert> = {
          version: task.version + 1,
        };
        if (body.title !== undefined) set.title = body.title;
        if (body.description !== undefined) set.description = body.description;
        if (body.assignee_id !== undefined) set.assigneeId = body.assignee_id;
        if (body.priority !== undefined) set.priority = body.priority;
        if (body.start_at !== undefined)
          set.startAt = body.start_at ? new Date(body.start_at) : null;
        if (body.due_at !== undefined) set.dueAt = body.due_at ? new Date(body.due_at) : null;
        if (body.remind_at !== undefined)
          set.remindAt = body.remind_at ? new Date(body.remind_at) : null;
        if (body.recurrence !== undefined) set.recurrence = body.recurrence;
        if (body.status !== undefined) set.status = body.status;
        if (enteringDone) {
          set.completedAt = now;
          set.completedBy = userId;
        } else if (leavingDone) {
          set.completedAt = null;
          set.completedBy = null;
        }
        if (listChanged) {
          set.listId = body.list_id;
          // 跨清单移动排到目标列尾部（等价一次隐式 move）
          set.sortOrder = await tailSortOrder(tx, body.list_id!);
        }

        // 乐观锁：版本不符/已被并发删除 → 0 行；区分 409 / 404
        // updatedAt 用 DB 时钟（与 insert 的 defaultNow 同源），避免应用/库双时钟漂移导致比较失真
        const updatedRows = await tx
          .update(tasks)
          .set({ ...set, updatedAt: sql`now()` })
          .where(and(eq(tasks.id, taskId), eq(tasks.version, ifMatch), isNull(tasks.deletedAt)))
          .returning();
        const updated = updatedRows[0];
        if (!updated) {
          const current = await tx.query.tasks.findFirst({
            where: eq(tasks.id, taskId),
            columns: { id: true, deletedAt: true },
          });
          if (current && current.deletedAt === null) {
            throw new ApiError(409, "VERSION_CONFLICT", COPY.common.versionConflict);
          }
          throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        }

        // 事件：状态流转用 task.status_changed（flows §8 广播 completed），否则 task.updated
        if (statusChanged) {
          await writeEvent(tx, {
            workspaceId: task.workspaceId,
            actorId: userId,
            type: "task.status_changed",
            entity: "task",
            entityId: taskId,
            payload: {
              list_id: updated.listId,
              from: task.status,
              to: updated.status,
              title: updated.title,
              version: updated.version,
            },
          });
        } else {
          await writeEvent(tx, {
            workspaceId: task.workspaceId,
            actorId: userId,
            type: "task.updated",
            entity: "task",
            entityId: taskId,
            payload: {
              list_id: updated.listId,
              ...(listChanged ? { from_list_id: task.listId } : {}),
              title: updated.title,
              status: updated.status,
              priority: updated.priority,
              assignee_id: updated.assigneeId,
              due_at: updated.dueAt?.toISOString() ?? null,
              version: updated.version,
            },
          });
        }

        // 负责人变更为他人 → assigned 通知
        if (
          body.assignee_id !== undefined &&
          body.assignee_id !== null &&
          body.assignee_id !== task.assigneeId
        ) {
          await notifyAssigned(tx, {
            task: updated,
            assigneeId: body.assignee_id,
            actorId: userId,
          });
        }

        // 重复任务：仅「进入 done」触发；每个原实例只生成一次后继（review 不触发）
        if (enteringDone && task.recurrence && !task.recurrenceSpawned && finalDueAt) {
          const next = nextOccurrence(task.recurrence, finalDueAt);
          // 标记已评估过生成（即使 until 耗尽不生成也不重复评估）
          await tx.update(tasks).set({ recurrenceSpawned: true }).where(eq(tasks.id, taskId));
          if (next !== null) {
            // start_at 按 due_at 的推进量平移（保持 开始→截止 时长）
            const deltaMs = next.getTime() - finalDueAt.getTime();
            const finalStartAt =
              body.start_at !== undefined
                ? body.start_at
                  ? new Date(body.start_at)
                  : null
                : task.startAt;
            const [successor] = await tx
              .insert(tasks)
              .values({
                id: uuidv7(),
                workspaceId: task.workspaceId,
                listId: updated.listId,
                title: updated.title,
                description: updated.description,
                assigneeId: updated.assigneeId,
                priority: updated.priority,
                startAt: finalStartAt ? new Date(finalStartAt.getTime() + deltaMs) : null,
                dueAt: next,
                recurrence: task.recurrence,
                sortOrder: await tailSortOrder(tx, updated.listId),
                createdBy: userId,
              })
              .returning();
            if (!successor) throw new ApiError(500, "INTERNAL", COPY.common.internal);
            await writeEvent(tx, {
              workspaceId: task.workspaceId,
              actorId: userId,
              type: "task.created",
              entity: "task",
              entityId: successor.id,
              payload: {
                list_id: successor.listId,
                title: successor.title,
                status: successor.status,
                priority: successor.priority,
                assignee_id: successor.assigneeId,
                due_at: successor.dueAt?.toISOString() ?? null,
                version: successor.version,
                recurrence: true,
                origin_task_id: taskId,
              },
            });
          }
        }

        return toTaskDto(updated, await subtaskCountsOf(taskId));
      });
    },

    /** 软删除（deleted_at；查询默认滤掉）。恢复端点属 P1 */
    async deleteTask(userId: string, taskId: string): Promise<void> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "task.write");
      await db.transaction(async (tx) => {
        await tx
          .update(tasks)
          .set({ deletedAt: new Date(), updatedAt: sql`now()` })
          .where(eq(tasks.id, taskId));
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "task.deleted",
          entity: "task",
          entityId: taskId,
          payload: { list_id: task.listId, title: task.title },
        });
      });
    },

    /** 列内手动排序（后写者胜，无乐观锁；跨清单移动走 PATCH list_id） */
    async moveTask(userId: string, taskId: string, body: MoveBody): Promise<Task> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "task.write");
      if (body.before_id === taskId || body.after_id === taskId) {
        throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
      }
      return db.transaction(async (tx) => {
        const siblings = await tx
          .select({ id: tasks.id, sortOrder: tasks.sortOrder })
          .from(tasks)
          .where(and(eq(tasks.listId, task.listId), isNull(tasks.deletedAt), ne(tasks.id, taskId)))
          .orderBy(asc(tasks.sortOrder));

        let prev: { id: string; sortOrder: number } | null = null;
        let next: { id: string; sortOrder: number } | null = null;
        if (body.after_id != null) {
          prev = siblings.find((s) => s.id === body.after_id) ?? null;
          if (prev === null)
            throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
        }
        if (body.before_id != null) {
          next = siblings.find((s) => s.id === body.before_id) ?? null;
          if (next === null)
            throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
        }

        let sortOrder = gapInsertOrder(prev?.sortOrder ?? null, next?.sortOrder ?? null);
        if (sortOrder === null) {
          // 间隙耗尽：同事务整列重排（保持相对顺序）后重算
          const fresh = resequencedOrders(siblings.length);
          for (const [i, row] of siblings.entries()) {
            // oxlint-disable-next-line no-await-in-loop -- 事务内串行写是有意设计：重排必须按序落库
            await tx
              .update(tasks)
              .set({ sortOrder: fresh[i] ?? 0 })
              .where(eq(tasks.id, row.id));
          }
          const remapped = siblings.map((s, i) => ({ id: s.id, sortOrder: fresh[i] ?? 0 }));
          // 固定到 const 以保留 null 收窄（let 在闭包内不保留收窄）
          const prevFixed = prev;
          const nextFixed = next;
          const prev2 =
            prevFixed === null ? null : (remapped.find((s) => s.id === prevFixed.id) ?? null);
          const next2 =
            nextFixed === null ? null : (remapped.find((s) => s.id === nextFixed.id) ?? null);
          sortOrder = gapInsertOrder(prev2?.sortOrder ?? null, next2?.sortOrder ?? null);
          if (sortOrder === null) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        }

        const [updated] = await tx
          .update(tasks)
          .set({ sortOrder, updatedAt: sql`now()` })
          .where(eq(tasks.id, taskId))
          .returning();
        if (!updated) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "task.reordered",
          entity: "task",
          entityId: taskId,
          payload: { list_id: task.listId, sort_order: sortOrder },
        });
        return toTaskDto(updated, await subtaskCountsOf(taskId));
      });
    },

    /**
     * 任务查询（P0-11/P0-14/P0-15）：智能视图（先置条件集）+ 四筛 + q + 排序 + 键集游标。
     * 游标实现选择：(sort_key, id) 复合键，base64url(JSON) 编码；
     * due_at 可空列做 NULL 感知的键集比较（asc NULLS LAST / desc NULLS FIRST，同 PG 默认）。
     */
    async queryTasks(userId: string, workspaceId: string, q: TaskQuery): Promise<CursorPage<Task>> {
      await requireCan(db, workspaceId, userId, "task.read");

      const conditions: SQL[] = [eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)];

      // 智能视图（先置条件集，可与筛选叠加）
      if (q.view === "today") {
        const { start, end } = localTodayUtcRange(q.tz_offset ?? 0);
        conditions.push(gte(tasks.dueAt, start), lt(tasks.dueAt, end));
      } else if (q.view === "mine") {
        conditions.push(eq(tasks.assigneeId, userId), ne(tasks.status, "done"));
      } else if (q.view === "overdue") {
        conditions.push(lt(tasks.dueAt, new Date()), ne(tasks.status, "done"));
      }

      // 四筛（负责人/状态/优先级/截止区间）+ 清单
      if (q.list_id !== undefined) conditions.push(eq(tasks.listId, q.list_id));
      if (q.assignee_id !== undefined) conditions.push(eq(tasks.assigneeId, q.assignee_id));
      if (q.status !== undefined) {
        conditions.push(
          Array.isArray(q.status) ? inArray(tasks.status, q.status) : eq(tasks.status, q.status),
        );
      }
      if (q.priority !== undefined) {
        conditions.push(
          Array.isArray(q.priority)
            ? inArray(tasks.priority, q.priority)
            : eq(tasks.priority, q.priority),
        );
      }
      if (q.due_from !== undefined) conditions.push(gte(tasks.dueAt, new Date(q.due_from)));
      if (q.due_to !== undefined) conditions.push(lte(tasks.dueAt, new Date(q.due_to)));

      // 全文搜索（ILIKE 标题+描述，转义 % _ 与转义符本身）
      if (q.q !== undefined) {
        const pattern = `%${escapeIlike(q.q)}%`;
        conditions.push(
          or(
            sql`${tasks.title} ILIKE ${pattern} ESCAPE '\\'`,
            sql`coalesce(${tasks.description}, '') ILIKE ${pattern} ESCAPE '\\'`,
          )!,
        );
      }

      // 排序键定义：表达式 / 行→键 / 键集比较条件
      const ascDir = q.order !== "desc";
      type SortSpec = {
        orderBy: SQL[];
        keyOf: (row: TaskRow) => string | number | null;
        keyset: (key: string | number | null, id: string) => SQL;
      };
      const nonNullKeyset = (col: SQL | typeof tasks.sortOrder): SortSpec["keyset"] => {
        return (key, id) =>
          ascDir
            ? sql`(${col} > ${key} OR (${col} = ${key} AND ${tasks.id} > ${id}))`
            : sql`(${col} < ${key} OR (${col} = ${key} AND ${tasks.id} < ${id}))`;
      };
      const sortSpec: SortSpec = (() => {
        switch (q.sort) {
          case "due_at": {
            const orderBy = ascDir
              ? [asc(tasks.dueAt), asc(tasks.id)]
              : [desc(tasks.dueAt), desc(tasks.id)];
            const keyset = (key: string | number | null, id: string): SQL => {
              // NULL 感知键集：asc 时空值在最后、desc 时空值在最前（PG 默认）
              // key 为 ISO 字符串参数（postgres.js 无法序列化 raw Date，PG 自动推断 timestamptz）
              if (ascDir) {
                return key === null
                  ? sql`(${tasks.dueAt} IS NULL AND ${tasks.id} > ${id})`
                  : sql`(${tasks.dueAt} > ${key} OR (${tasks.dueAt} = ${key} AND ${tasks.id} > ${id}) OR ${tasks.dueAt} IS NULL)`;
              }
              return key === null
                ? sql`((${tasks.dueAt} IS NULL AND ${tasks.id} < ${id}) OR ${tasks.dueAt} IS NOT NULL)`
                : sql`(${tasks.dueAt} < ${key} OR (${tasks.dueAt} = ${key} AND ${tasks.id} < ${id}))`;
            };
            return { orderBy, keyOf: dueAtKeyOf, keyset };
          }
          case "priority":
            return {
              orderBy: ascDir
                ? [asc(PRIORITY_RANK_SQL), asc(tasks.id)]
                : [desc(PRIORITY_RANK_SQL), desc(tasks.id)],
              keyOf: (row) =>
                row.priority === "high"
                  ? 0
                  : row.priority === "mid"
                    ? 1
                    : row.priority === "low"
                      ? 2
                      : 3,
              keyset: nonNullKeyset(PRIORITY_RANK_SQL),
            };
          case "created_at": {
            // 毫秒截断归一（PG 微秒 vs JS 毫秒），排序与键集同源
            const trunc = sql`date_trunc('milliseconds', ${tasks.createdAt})`;
            return {
              orderBy: ascDir ? [asc(trunc), asc(tasks.id)] : [desc(trunc), desc(tasks.id)],
              keyOf: (row) => row.createdAt.toISOString(),
              keyset: (key, id) =>
                ascDir
                  ? sql`(${trunc} > ${key} OR (${trunc} = ${key} AND ${tasks.id} > ${id}))`
                  : sql`(${trunc} < ${key} OR (${trunc} = ${key} AND ${tasks.id} < ${id}))`,
            };
          }
          case "updated_at": {
            const trunc = sql`date_trunc('milliseconds', ${tasks.updatedAt})`;
            return {
              orderBy: ascDir ? [asc(trunc), asc(tasks.id)] : [desc(trunc), desc(tasks.id)],
              keyOf: (row) => row.updatedAt.toISOString(),
              keyset: (key, id) =>
                ascDir
                  ? sql`(${trunc} > ${key} OR (${trunc} = ${key} AND ${tasks.id} > ${id}))`
                  : sql`(${trunc} < ${key} OR (${trunc} = ${key} AND ${tasks.id} < ${id}))`,
            };
          }
          default:
            return {
              orderBy: ascDir
                ? [asc(tasks.sortOrder), asc(tasks.id)]
                : [desc(tasks.sortOrder), desc(tasks.id)],
              keyOf: (row) => row.sortOrder,
              keyset: nonNullKeyset(tasks.sortOrder),
            };
        }
      })();

      if (q.cursor !== undefined) {
        const c = decodeTaskCursor(q.cursor);
        conditions.push(sortSpec.keyset(c.key, c.id));
      }

      const rows = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(...sortSpec.orderBy)
        .limit(q.limit + 1);
      const items = rows.slice(0, q.limit);
      const last = items[items.length - 1];
      // 子任务进度随 DTO 带出（看板卡片 n/m）：一次分组查询覆盖本页
      const counts = await subtaskCountsMap(items.map((t) => t.id));
      return {
        items: items.map((t) => toTaskDto(t, counts.get(t.id) ?? ZERO_COUNTS)),
        next_cursor:
          rows.length > q.limit && last ? encodeTaskCursor(sortSpec.keyOf(last), last.id) : null,
      };
    },
  };
}
