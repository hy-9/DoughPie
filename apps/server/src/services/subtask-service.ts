import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  COPY,
  SUBTASKS_PER_TASK_MAX,
  type CreateSubtaskBody,
  type Subtask,
  type UpdateSubtaskBody,
} from "@doughpie/shared";
import type { Db } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { subtasks, tasks, type SubtaskRow, type TaskRow } from "../models/schema.js";
import { writeEvent } from "./event-service.js";
import { gapInsertOrder } from "./sort-order.js";
import { requireCan } from "./workspace-guard.js";

/**
 * 子任务业务流（P0-9）：仅标题 + 完成态；每任务 ≤50 个；排序按创建序（间隙值，无 move 端点）。
 */

export interface SubtaskServiceDeps {
  db: Db;
}

export type SubtaskService = ReturnType<typeof createSubtaskService>;

function toSubtaskDto(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    task_id: row.taskId,
    title: row.title,
    done: row.done,
    sort_order: row.sortOrder,
    created_at: row.createdAt.toISOString(),
  };
}

export function createSubtaskService(deps: SubtaskServiceDeps) {
  const { db } = deps;

  async function loadTask(taskId: string): Promise<TaskRow> {
    const row = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
    });
    if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    return row;
  }

  async function loadSubtask(subtaskId: string): Promise<{ subtask: SubtaskRow; task: TaskRow }> {
    const row = await db.query.subtasks.findFirst({ where: eq(subtasks.id, subtaskId) });
    if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    const task = await loadTask(row.taskId);
    return { subtask: row, task };
  }

  return {
    /** 子任务列表（按创建序） */
    async listSubtasks(userId: string, taskId: string): Promise<Subtask[]> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "subtask.read");
      const rows = await db
        .select()
        .from(subtasks)
        .where(eq(subtasks.taskId, taskId))
        .orderBy(asc(subtasks.sortOrder));
      return rows.map(toSubtaskDto);
    },

    /** 新建子任务：每任务 ≤50 个 → 409 SUBTASK_LIMIT；排尾 */
    async createSubtask(userId: string, taskId: string, body: CreateSubtaskBody): Promise<Subtask> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "subtask.write");
      return db.transaction(async (tx) => {
        const [countRow] = await tx
          .select({ value: count() })
          .from(subtasks)
          .where(eq(subtasks.taskId, taskId));
        if ((countRow?.value ?? 0) >= SUBTASKS_PER_TASK_MAX) {
          throw new ApiError(409, "SUBTASK_LIMIT", COPY.task.subtaskLimit);
        }
        const tailRows = await tx
          .select({ sortOrder: subtasks.sortOrder })
          .from(subtasks)
          .where(eq(subtasks.taskId, taskId))
          .orderBy(desc(subtasks.sortOrder))
          .limit(1);
        const sortOrder = gapInsertOrder(tailRows[0]?.sortOrder ?? null, null);
        if (sortOrder === null) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        const [row] = await tx
          .insert(subtasks)
          .values({ id: uuidv7(), taskId, title: body.title, sortOrder })
          .returning();
        if (!row) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "subtask.created",
          entity: "subtask",
          entityId: row.id,
          payload: { task_id: taskId, title: row.title },
        });
        return toSubtaskDto(row);
      });
    },

    /** 改标题/完成态 */
    async updateSubtask(
      userId: string,
      subtaskId: string,
      body: UpdateSubtaskBody,
    ): Promise<Subtask> {
      const { task } = await loadSubtask(subtaskId);
      await requireCan(db, task.workspaceId, userId, "subtask.write");
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(subtasks)
          .set({
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.done !== undefined ? { done: body.done } : {}),
          })
          .where(eq(subtasks.id, subtaskId))
          .returning();
        if (rows.length === 0) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "subtask.updated",
          entity: "subtask",
          entityId: subtaskId,
          payload: {
            task_id: task.id,
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.done !== undefined ? { done: body.done } : {}),
          },
        });
        return rows;
      });
      if (!updated) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      return toSubtaskDto(updated);
    },

    /** 删除子任务（硬删除：子任务无回收站语义） */
    async deleteSubtask(userId: string, subtaskId: string): Promise<void> {
      const { subtask, task } = await loadSubtask(subtaskId);
      await requireCan(db, task.workspaceId, userId, "subtask.write");
      await db.transaction(async (tx) => {
        await tx.delete(subtasks).where(eq(subtasks.id, subtaskId));
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "subtask.deleted",
          entity: "subtask",
          entityId: subtaskId,
          payload: { task_id: task.id, title: subtask.title },
        });
      });
    },
  };
}
