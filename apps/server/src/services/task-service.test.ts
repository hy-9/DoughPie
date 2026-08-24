import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { RecurrenceRule } from "@doughpie/shared";
import type { Db } from "../db.js";
import { events, notifications, tasks } from "../models/schema.js";
import { createTaskService, localTodayUtcRange, type TaskService } from "./task-service.js";
import {
  insertList,
  insertMembership,
  insertTask,
  insertUser,
  insertWorkspace,
} from "../../tests/factories.js";
import { createTestDb, truncateAll } from "../../tests/helpers.js";

/**
 * L2 任务业务流（P0-4/P0-10/P0-14/P0-15）：CRUD + If-Match 乐观锁 + 四态状态机 +
 * 软删除 + 智能视图/四筛/搜索/排序/游标 + 重复任务触发。
 * 断言从规格推导（backend.md §3/§4、PLAN.md §4/§6.2）。
 */

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ statusCode: status, code });
}

describe("任务服务（L2）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let svc: TaskService;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
    svc = createTaskService({ db });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  /** 搭建：owner + 工作区 + 清单 */
  async function setup() {
    const owner = await insertUser(db, { username: "owner_u" });
    const ws = await insertWorkspace(db, owner);
    const list = await insertList(db, ws.id, { name: "默认" });
    return { owner, ws, list };
  }

  describe("创建与读取", () => {
    it("建任务：默认 todo/none，排尾 1000/2000；写 task.created 事件", async () => {
      const { owner, ws, list } = await setup();
      const t1 = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "甲" });
      const t2 = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "乙" });
      expect(t1.status).toBe("todo");
      expect(t1.priority).toBe("none");
      expect(t1.version).toBe(1);
      expect([t1.sort_order, t2.sort_order]).toEqual([1000, 2000]);

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "task.created")));
      expect(evRows).toHaveLength(2);
      expect(evRows[0]?.payload).toMatchObject({
        list_id: list.id,
        title: "甲",
        status: "todo",
        version: 1,
      });
    });

    it("建任务带 assignee：被分配者收 assigned 通知（🔴 高）；自派不发", async () => {
      const { owner, ws, list } = await setup();
      const member = await insertUser(db, { username: "member_u" });
      await insertMembership(db, ws.id, member.id, "member");

      await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "派给成员",
        assignee_id: member.id,
      });
      const ntfs = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, member.id), eq(notifications.type, "assigned")));
      expect(ntfs).toHaveLength(1);
      expect(ntfs[0]?.level).toBe("high");
      expect(ntfs[0]?.payload).toMatchObject({ title: "派给成员" });
      expect(ntfs[0]?.actorId).toBe(owner.id);

      // 自派不产生通知
      await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "派给自己",
        assignee_id: owner.id,
      });
      const selfNtfs = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, owner.id), eq(notifications.type, "assigned")));
      expect(selfNtfs).toHaveLength(0);
    });

    it("建任务校验：assignee 非本区成员 → 400；list 不存在 → 404；recurrence 无 due_at → 400 RECURRENCE_INVALID", async () => {
      const { owner, ws, list } = await setup();
      const outsider = await insertUser(db, { username: "outsider_u" });

      await expectApiError(
        svc.createTask(owner.id, ws.id, { list_id: list.id, title: "x", assignee_id: outsider.id }),
        400,
        "VALIDATION_FAILED",
      );
      await expectApiError(
        svc.createTask(owner.id, ws.id, { list_id: crypto.randomUUID(), title: "x" }),
        404,
        "NOT_FOUND",
      );
      await expectApiError(
        svc.createTask(owner.id, ws.id, {
          list_id: list.id,
          title: "x",
          recurrence: { freq: "daily", interval: 1 },
        }),
        400,
        "RECURRENCE_INVALID",
      );
    });

    it("读取：viewer 可读；非成员 → 403；软删后 → 404", async () => {
      const { owner, ws, list } = await setup();
      const viewer = await insertUser(db, { username: "viewer_u" });
      const outsider = await insertUser(db, { username: "outsider_u" });
      await insertMembership(db, ws.id, viewer.id, "viewer");
      const t = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "可读" });

      expect((await svc.getTask(viewer.id, t.id)).title).toBe("可读");
      await expectApiError(svc.getTask(outsider.id, t.id), 403, "FORBIDDEN");

      await svc.deleteTask(owner.id, t.id);
      await expectApiError(svc.getTask(owner.id, t.id), 404, "NOT_FOUND");
    });
  });

  describe("更新与乐观锁", () => {
    it("If-Match 命中 → version+1 并写 task.updated；不符 → 409 VERSION_CONFLICT", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "旧标题" });

      const updated = await svc.updateTask(owner.id, t.id, 1, { title: "新标题" });
      expect(updated.title).toBe("新标题");
      expect(updated.version).toBe(2);

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "task.updated")));
      expect(evRows).toHaveLength(1);
      expect(evRows[0]?.payload).toMatchObject({ title: "新标题", version: 2 });

      // 旧版本再写 → 409
      await expectApiError(
        svc.updateTask(owner.id, t.id, 1, { title: "并发写" }),
        409,
        "VERSION_CONFLICT",
      );
    });

    it("状态机：todo 直达 done 合法，记 completed_at/by；done→todo 清空；写 task.status_changed", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "流转" });

      const done = await svc.updateTask(owner.id, t.id, 1, { status: "done" });
      expect(done.status).toBe("done");
      expect(done.completed_at).not.toBeNull();
      expect(done.completed_by).toBe(owner.id);

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "task.status_changed")));
      expect(evRows).toHaveLength(1);
      expect(evRows[0]?.payload).toMatchObject({ from: "todo", to: "done" });

      const reopened = await svc.updateTask(owner.id, t.id, 2, { status: "todo" });
      expect(reopened.completed_at).toBeNull();
      expect(reopened.completed_by).toBeNull();
    });

    it("状态未变化（done→done）不写 status_changed 事件，只写 task.updated", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "重复" });
      await svc.updateTask(owner.id, t.id, 1, { status: "done" });
      await svc.updateTask(owner.id, t.id, 2, { status: "done", title: "顺带改题" });

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "task.status_changed")));
      expect(evRows).toHaveLength(1); // 仅第一次流转
    });

    it("assignee 变更 → 新负责人收 assigned 通知；清空 assignee 不发通知", async () => {
      const { owner, ws, list } = await setup();
      const m1 = await insertUser(db, { username: "m1" });
      const m2 = await insertUser(db, { username: "m2" });
      await insertMembership(db, ws.id, m1.id, "member");
      await insertMembership(db, ws.id, m2.id, "member");
      const t = await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "转派",
        assignee_id: m1.id,
      });

      await svc.updateTask(owner.id, t.id, 1, { assignee_id: m2.id });
      const m2Ntfs = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, m2.id), eq(notifications.type, "assigned")));
      expect(m2Ntfs).toHaveLength(1);

      await svc.updateTask(owner.id, t.id, 2, { assignee_id: null });
      const after = await svc.getTask(owner.id, t.id);
      expect(after.assignee_id).toBeNull();
      // 清空不再产生任何 assigned 通知
      const allNtfs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, "assigned"));
      expect(allNtfs).toHaveLength(2); // 建任务给 m1 + 转派给 m2
    });

    it("recurrence 与 due_at 联合校验：更新后规则存在但 due_at 被清空 → 400 RECURRENCE_INVALID", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "周期",
        due_at: "2026-09-01T09:00:00.000Z",
        recurrence: { freq: "daily", interval: 1 },
      });
      await expectApiError(
        svc.updateTask(owner.id, t.id, 1, { due_at: null }),
        400,
        "RECURRENCE_INVALID",
      );
      // 解除规则的同时清 due_at 合法
      const ok = await svc.updateTask(owner.id, t.id, 1, { due_at: null, recurrence: null });
      expect(ok.due_at).toBeNull();
      expect(ok.recurrence).toBeNull();
    });

    it("跨清单移动（PATCH list_id）：排到目标列尾部并携带 from_list_id 事件载荷", async () => {
      const { owner, ws, list } = await setup();
      const target = await insertList(db, ws.id, { name: "目标列" });
      const exist = await insertTask(db, {
        workspaceId: ws.id,
        listId: target.id,
        createdBy: owner.id,
        sortOrder: 1000,
      });
      const t = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "跨列" });

      const moved = await svc.updateTask(owner.id, t.id, 1, { list_id: target.id });
      expect(moved.list_id).toBe(target.id);
      expect(moved.sort_order).toBe(2000); // 排在 exist 之后
      expect(exist.listId).toBe(target.id);

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "task.updated")));
      expect(evRows[0]?.payload).toMatchObject({ list_id: target.id, from_list_id: list.id });

      // 目标清单在其他工作区 → 404
      const otherOwner = await insertUser(db, { username: "other_owner" });
      const otherWs = await insertWorkspace(db, otherOwner);
      const foreignList = await insertList(db, otherWs.id);
      await expectApiError(
        svc.updateTask(owner.id, t.id, 2, { list_id: foreignList.id }),
        404,
        "NOT_FOUND",
      );
    });

    it("软删除：写 task.deleted 事件，查询默认滤掉", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "删除我" });
      await svc.deleteTask(owner.id, t.id);

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "task.deleted")));
      expect(evRows).toHaveLength(1);
      expect(evRows[0]?.payload).toMatchObject({ list_id: list.id, title: "删除我" });

      const page = await svc.queryTasks(owner.id, ws.id, {
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(page.items).toHaveLength(0);
      // 行仍在（软删）
      const row = await db.query.tasks.findFirst({ where: eq(tasks.id, t.id) });
      expect(row?.deletedAt).not.toBeNull();
    });

    it("viewer 不可写；非成员不可读写", async () => {
      const { owner, ws, list } = await setup();
      const viewer = await insertUser(db, { username: "viewer_u" });
      const outsider = await insertUser(db, { username: "outsider_u" });
      await insertMembership(db, ws.id, viewer.id, "viewer");
      const t = await svc.createTask(owner.id, ws.id, { list_id: list.id, title: "权限" });

      await expectApiError(
        svc.createTask(viewer.id, ws.id, { list_id: list.id, title: "x" }),
        403,
        "FORBIDDEN",
      );
      await expectApiError(svc.updateTask(viewer.id, t.id, 1, { title: "x" }), 403, "FORBIDDEN");
      await expectApiError(svc.deleteTask(viewer.id, t.id), 403, "FORBIDDEN");
      await expectApiError(svc.deleteTask(outsider.id, t.id), 403, "FORBIDDEN");
    });
  });

  describe("列内排序 move", () => {
    it("插入中间取中位 + 写 task.reordered 事件", async () => {
      const { owner, ws, list } = await setup();
      const t1 = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        sortOrder: 1000,
      });
      const t2 = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        sortOrder: 2000,
      });
      const t3 = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        sortOrder: 3000,
      });

      const moved = await svc.moveTask(owner.id, t3.id, { after_id: t1.id, before_id: t2.id });
      expect(moved.sort_order).toBe(1500);

      const tail = await svc.moveTask(owner.id, t1.id, { after_id: t3.id });
      expect(tail.sort_order).toBe(2500);

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "task.reordered")));
      expect(evRows).toHaveLength(2);
      expect(evRows[0]?.payload).toMatchObject({ list_id: list.id, sort_order: 1500 });
    });

    it("落点引用其他清单的任务 → 400 VALIDATION_FAILED", async () => {
      const { owner, ws, list } = await setup();
      const other = await insertList(db, ws.id, { name: "另一列" });
      const t1 = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        sortOrder: 1000,
      });
      const alien = await insertTask(db, {
        workspaceId: ws.id,
        listId: other.id,
        createdBy: owner.id,
        sortOrder: 1000,
      });
      await expectApiError(
        svc.moveTask(owner.id, t1.id, { after_id: alien.id }),
        400,
        "VALIDATION_FAILED",
      );
    });
  });

  describe("重复任务触发（backend.md §4）", () => {
    const daily: RecurrenceRule = { freq: "daily", interval: 1 };

    it("done 触发下一实例：复制字段 + due_at 推进 + 排尾 + todo；写 task.created；原实例标记 recurrence_spawned", async () => {
      const { owner, ws, list } = await setup();
      const member = await insertUser(db, { username: "member_u" });
      await insertMembership(db, ws.id, member.id, "member");
      // 占位任务：占据 5000 位，验证后继排尾
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        sortOrder: 5000,
      });
      const t = await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "每日站会",
        description: "例会",
        priority: "high",
        assignee_id: member.id,
        start_at: "2026-09-01T01:00:00.000Z",
        due_at: "2026-09-01T09:00:00.000Z",
        recurrence: daily,
      });

      const done = await svc.updateTask(owner.id, t.id, 1, { status: "done" });
      expect(done.status).toBe("done");

      // 下一实例
      const page = await svc.queryTasks(owner.id, ws.id, {
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      const successor = page.items.find(
        (x) => x.recurrence !== null && x.status === "todo" && x.id !== t.id,
      );
      expect(successor).toBeDefined();
      expect(successor?.title).toBe("每日站会");
      expect(successor?.description).toBe("例会");
      expect(successor?.priority).toBe("high");
      expect(successor?.assignee_id).toBe(member.id);
      expect(successor?.due_at).toBe("2026-09-02T09:00:00.000Z");
      // start_at 按 due 推进量平移（保持时长 8h）
      expect(successor?.start_at).toBe("2026-09-02T01:00:00.000Z");
      expect(successor?.sort_order).toBe(7000); // 排尾（exist 5000、原实例 6000 之后）
      expect(successor?.version).toBe(1);
      expect(successor?.completed_at).toBeNull();

      // 原实例标记防重
      const origin = await db.query.tasks.findFirst({ where: eq(tasks.id, t.id) });
      expect(origin?.recurrenceSpawned).toBe(true);

      // 事件：status_changed + created（flows §8 广播 completed + created）
      const evRows = await db.select().from(events).where(eq(events.workspaceId, ws.id));
      const statusEv = evRows.filter((e) => e.type === "task.status_changed");
      const createdEv = evRows.filter((e) => e.type === "task.created");
      expect(statusEv).toHaveLength(1);
      expect(createdEv.map((e) => e.entityId)).toContain(successor?.id);
      const successorEv = createdEv.find((e) => e.entityId === successor?.id);
      expect(successorEv?.payload).toMatchObject({ recurrence: true, origin_task_id: t.id });
    });

    it("review 态不触发生成（review 不算完成）", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "待验收",
        due_at: "2026-09-01T09:00:00.000Z",
        recurrence: daily,
      });
      await svc.updateTask(owner.id, t.id, 1, { status: "review" });

      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws.id), isNull(tasks.deletedAt)));
      expect(rows).toHaveLength(1); // 没有新实例
    });

    it("防重：done 后再 PATCH done（无状态变化）不生成；重开再完成也不重复生成", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "防重",
        due_at: "2026-09-01T09:00:00.000Z",
        recurrence: daily,
      });

      await svc.updateTask(owner.id, t.id, 1, { status: "done" });
      // 无状态变化的再次 done（顺带改标题走 task.updated）
      await svc.updateTask(owner.id, t.id, 2, { status: "done", title: "防重2" });
      // 重开再完成：每个原实例只生成一次后继
      await svc.updateTask(owner.id, t.id, 3, { status: "todo" });
      await svc.updateTask(owner.id, t.id, 4, { status: "done" });

      const recurrences = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws.id), isNull(tasks.deletedAt)));
      // 原实例 + 唯一后继
      expect(recurrences).toHaveLength(2);
    });

    it("until 耗尽：下一次 > until → 不生成后继（原实例仍标记已评估）", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "到期",
        due_at: "2026-09-01T09:00:00.000Z",
        recurrence: { freq: "daily", interval: 1, until: "2026-09-01T12:00:00.000Z" },
      });
      await svc.updateTask(owner.id, t.id, 1, { status: "done" });

      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws.id), isNull(tasks.deletedAt)));
      expect(rows).toHaveLength(1);
      const origin = await db.query.tasks.findFirst({ where: eq(tasks.id, t.id) });
      expect(origin?.recurrenceSpawned).toBe(true);
    });

    it("monthly 月末 clamp 端到端：1/31 完成 → 下一实例 2/28（平年）", async () => {
      const { owner, ws, list } = await setup();
      const t = await svc.createTask(owner.id, ws.id, {
        list_id: list.id,
        title: "月末结账",
        due_at: "2026-01-31T09:00:00.000Z",
        recurrence: { freq: "monthly", interval: 1 },
      });
      await svc.updateTask(owner.id, t.id, 1, { status: "done" });
      const page = await svc.queryTasks(owner.id, ws.id, {
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      const successor = page.items.find((x) => x.id !== t.id);
      expect(successor?.due_at).toBe("2026-02-28T09:00:00.000Z");
    });
  });

  describe("查询（P0-11/P0-14/P0-15）", () => {
    it("view=today：按 tz_offset 换算当地今天 UTC 区间；缺省 UTC 天", async () => {
      const { owner, ws, list } = await setup();
      // 本地时区 UTC+8（tz_offset=-480）：当地今天 = UTC [前一天16:00, 当天16:00)
      const now = new Date();
      const localMs = now.getTime() + 480 * 60000;
      const localDayStart = Math.floor(localMs / 86400000) * 86400000;
      const todayStartUtc = new Date(localDayStart - 480 * 60000);
      const inToday = new Date(todayStartUtc.getTime() + 3600 * 1000);
      const outToday = new Date(todayStartUtc.getTime() - 3600 * 1000);
      const tIn = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        dueAt: inToday,
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        dueAt: outToday,
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        dueAt: null,
      });

      const page = await svc.queryTasks(owner.id, ws.id, {
        view: "today",
        tz_offset: -480,
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(page.items.map((t) => t.id)).toEqual([tIn.id]);
    });

    it("view=mine：我负责且未 done；view=overdue：due_at<now 且未 done", async () => {
      const { owner, ws, list } = await setup();
      const member = await insertUser(db, { username: "member_u" });
      await insertMembership(db, ws.id, member.id, "member");
      const mine = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        assigneeId: member.id,
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        assigneeId: member.id,
        status: "done", // 已完成不算 mine
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        assigneeId: owner.id, // 别人的
      });

      const minePage = await svc.queryTasks(member.id, ws.id, {
        view: "mine",
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(minePage.items.map((t) => t.id)).toEqual([mine.id]);

      const overdue = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        dueAt: new Date(Date.now() - 3600 * 1000),
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        dueAt: new Date(Date.now() - 7200 * 1000),
        status: "done", // 已完成的逾期不算
      });
      const overduePage = await svc.queryTasks(owner.id, ws.id, {
        view: "overdue",
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(overduePage.items.map((t) => t.id)).toEqual([overdue.id]);
    });

    it("四筛叠加：status 数组 + priority + assignee + 截止区间 + list_id", async () => {
      const { owner, ws, list } = await setup();
      const list2 = await insertList(db, ws.id, { name: "第二列" });
      const m1 = await insertUser(db, { username: "m1" });
      await insertMembership(db, ws.id, m1.id, "member");

      const hit = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        status: "doing",
        priority: "high",
        assigneeId: m1.id,
        dueAt: new Date("2026-09-10T00:00:00Z"),
      });
      // 各维度各造一个反例
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        status: "todo", // 状态不符
        priority: "high",
        assigneeId: m1.id,
        dueAt: new Date("2026-09-10T00:00:00Z"),
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        status: "doing",
        priority: "low", // 优先级不符
        assigneeId: m1.id,
        dueAt: new Date("2026-09-10T00:00:00Z"),
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        status: "doing",
        priority: "high",
        assigneeId: m1.id,
        dueAt: new Date("2026-10-10T00:00:00Z"), // 区间外
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list2.id, // 清单不符
        createdBy: owner.id,
        status: "doing",
        priority: "high",
        assigneeId: m1.id,
        dueAt: new Date("2026-09-10T00:00:00Z"),
      });

      const page = await svc.queryTasks(owner.id, ws.id, {
        list_id: list.id,
        assignee_id: m1.id,
        status: ["doing", "review"],
        priority: "high",
        due_from: "2026-09-01T00:00:00.000Z",
        due_to: "2026-09-30T00:00:00.000Z",
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(page.items.map((t) => t.id)).toEqual([hit.id]);
    });

    it("q 搜索：ILIKE 命中标题与描述；% 与 _ 按字面转义", async () => {
      const { owner, ws, list } = await setup();
      const byTitle = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        title: "发布 v1.0 版本",
      });
      const byDesc = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        title: "无关",
        description: "备注里有发布计划",
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        title: "完全无关",
      });

      const page = await svc.queryTasks(owner.id, ws.id, {
        q: "发布",
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(new Set(page.items.map((t) => t.id))).toEqual(new Set([byTitle.id, byDesc.id]));

      // % 应被转义为字面量：标题含「100%」命中「100%」，而不是任意「100」
      const percent = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        title: "进度 100% 达成",
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        title: "进度 1000 件",
      });
      const pctPage = await svc.queryTasks(owner.id, ws.id, {
        q: "100%",
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(pctPage.items.map((t) => t.id)).toEqual([percent.id]);

      // _ 同样按字面
      const under = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        title: "文件 a_b.txt",
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        title: "文件 axb.txt",
      });
      const underPage = await svc.queryTasks(owner.id, ws.id, {
        q: "a_b",
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(underPage.items.map((t) => t.id)).toEqual([under.id]);
    });

    it("排序切换：priority asc 高优先在前；due_at asc 空值在最后；created_at desc", async () => {
      const { owner, ws, list } = await setup();
      const low = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        priority: "low",
        sortOrder: 1000,
      });
      const high = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        priority: "high",
        sortOrder: 2000,
      });
      const none = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        priority: "none",
        sortOrder: 3000,
      });

      const byPriority = await svc.queryTasks(owner.id, ws.id, {
        limit: 50,
        sort: "priority",
        order: "asc",
      });
      expect(byPriority.items.map((t) => t.id)).toEqual([high.id, low.id, none.id]);

      const due1 = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        dueAt: new Date("2026-09-01T00:00:00Z"),
      });
      const due2 = await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        dueAt: new Date("2026-08-01T00:00:00Z"),
      });
      const byDue = await svc.queryTasks(owner.id, ws.id, {
        limit: 50,
        sort: "due_at",
        order: "asc",
      });
      // due2 < due1 < 三个空 due_at（null 在最后）
      expect(byDue.items[0]?.id).toBe(due2.id);
      expect(byDue.items[1]?.id).toBe(due1.id);
      expect(byDue.items.slice(2).every((t) => t.due_at === null)).toBe(true);

      const byCreated = await svc.queryTasks(owner.id, ws.id, {
        limit: 50,
        sort: "created_at",
        order: "desc",
      });
      // 最新创建的排最前
      expect(byCreated.items[0]?.id).toBe(due2.id);
    });

    it("游标分页：两页不重复不遗漏，next_cursor 终止为 null", async () => {
      const { owner, ws, list } = await setup();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        // oxlint-disable-next-line no-await-in-loop -- 串行插入：保证 id 顺序即断言顺序
        const t = await insertTask(db, {
          workspaceId: ws.id,
          listId: list.id,
          createdBy: owner.id,
          sortOrder: (i + 1) * 1000,
        });
        ids.push(t.id);
      }

      const page1 = await svc.queryTasks(owner.id, ws.id, {
        limit: 2,
        sort: "sort_order",
        order: "asc",
      });
      expect(page1.items.map((t) => t.id)).toEqual(ids.slice(0, 2));
      expect(page1.next_cursor).not.toBeNull();

      const page2 = await svc.queryTasks(owner.id, ws.id, {
        limit: 2,
        sort: "sort_order",
        order: "asc",
        cursor: page1.next_cursor ?? undefined,
      });
      expect(page2.items.map((t) => t.id)).toEqual(ids.slice(2, 4));

      const page3 = await svc.queryTasks(owner.id, ws.id, {
        limit: 2,
        sort: "sort_order",
        order: "asc",
        cursor: page2.next_cursor ?? undefined,
      });
      expect(page3.items.map((t) => t.id)).toEqual(ids.slice(4));
      expect(page3.next_cursor).toBeNull();
    });

    it("view 与筛选可叠加；viewer 可查；非成员 403；非法游标 400", async () => {
      const { owner, ws, list } = await setup();
      const viewer = await insertUser(db, { username: "viewer_u" });
      const outsider = await insertUser(db, { username: "outsider_u" });
      await insertMembership(db, ws.id, viewer.id, "viewer");
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        assigneeId: owner.id,
        dueAt: new Date(Date.now() - 3600 * 1000),
      });
      await insertTask(db, {
        workspaceId: ws.id,
        listId: list.id,
        createdBy: owner.id,
        assigneeId: viewer.id,
        dueAt: new Date(Date.now() - 3600 * 1000),
      });

      // view=overdue + assignee 筛选叠加
      const page = await svc.queryTasks(viewer.id, ws.id, {
        view: "overdue",
        assignee_id: owner.id,
        limit: 50,
        sort: "sort_order",
        order: "asc",
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.assignee_id).toBe(owner.id);

      await expectApiError(
        svc.queryTasks(outsider.id, ws.id, { limit: 50, sort: "sort_order", order: "asc" }),
        403,
        "FORBIDDEN",
      );
      await expectApiError(
        svc.queryTasks(viewer.id, ws.id, {
          limit: 50,
          sort: "sort_order",
          order: "asc",
          cursor: "not-a-cursor",
        }),
        400,
        "VALIDATION_FAILED",
      );
    });
  });

  describe("localTodayUtcRange（today 视图换算）", () => {
    it("UTC+8（tz_offset=-480）：当地今天 = UTC 前一天 16:00 起 24h", () => {
      const now = new Date("2026-08-24T04:00:00.000Z"); // UTC+8 当地 12:00
      const { start, end } = localTodayUtcRange(-480, now);
      expect(start.toISOString()).toBe("2026-08-23T16:00:00.000Z");
      expect(end.toISOString()).toBe("2026-08-24T16:00:00.000Z");
    });

    it("UTC-5（tz_offset=300）：当地今天 = UTC 当天 05:00 起 24h", () => {
      const now = new Date("2026-08-24T12:00:00.000Z"); // UTC-5 当地 07:00
      const { start, end } = localTodayUtcRange(300, now);
      expect(start.toISOString()).toBe("2026-08-24T05:00:00.000Z");
      expect(end.toISOString()).toBe("2026-08-25T05:00:00.000Z");
    });

    it("缺省（0）即 UTC 天", () => {
      const now = new Date("2026-08-24T04:00:00.000Z");
      const { start, end } = localTodayUtcRange(0, now);
      expect(start.toISOString()).toBe("2026-08-24T00:00:00.000Z");
      expect(end.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    });

    it("当地跨日边界：UTC 23:00 在 UTC+8 已是次日", () => {
      const now = new Date("2026-08-24T23:30:00.000Z"); // UTC+8 = 2026-08-25 07:30
      const { start } = localTodayUtcRange(-480, now);
      expect(start.toISOString()).toBe("2026-08-24T16:00:00.000Z");
    });
  });
});
