import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { notifications } from "../models/schema.js";
import { createAuthService, type AuthService } from "./auth-service.js";
import { createCommentService } from "./comment-service.js";
import { createEventService } from "./event-service.js";
import { createListService } from "./list-service.js";
import { LoginGuard } from "./login-guard.js";
import { createNotificationService } from "./notification-service.js";
import { createTaskService } from "./task-service.js";
import { createTokenService } from "./token-service.js";
import { createWorkspaceService } from "./workspace-service.js";
import { createTestDb, truncateAll } from "../../tests/helpers.js";

/**
 * L2 端到端领域流（规格主线串联）：
 * 注册 → 建区 → 邀请 → 入区 → 建清单 → 建任务（指派）→ 分配通知 →
 * 评论 @ → 提及确认闭环（ack）→ 再提醒（24h 节流 429）→ 完成重复任务生成下一实例。
 * 全程断言 events 流完整有序（一石四鸟的数据源，D 阶段 socket 复用）。
 */
describe("领域端到端流（L2）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let authService: AuthService;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
    const tokenService = createTokenService({
      db,
      jwtSecret: "test-jwt-secret",
      accessTokenTtlSec: 1800,
      refreshTokenTtlDays: 30,
    });
    authService = createAuthService({
      db,
      tokenService,
      loginGuard: new LoginGuard({ maxFailures: 10, lockMinutes: 15 }),
      loginLockMinutes: 15,
    });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("注册建区→邀请入区→清单任务→分配通知→评论@→ack→再提醒节流→重复任务下一实例", async () => {
    const workspaceService = createWorkspaceService({ db });
    const listService = createListService({ db });
    const taskService = createTaskService({ db });
    const commentService = createCommentService({ db });
    const notificationService = createNotificationService({ db });
    const eventService = createEventService({ db });

    // ① 注册两个账号（首个为实例 admin，与工作区角色无关）
    const { user: alice } = await authService.register(
      { username: "alice", password: "pass1234" },
      {},
    );
    const { user: bob } = await authService.register({ username: "bob", password: "pass1234" }, {});

    // ② 建区（alice 即 owner）
    const ws = await workspaceService.create(alice.id, { name: "产品组" });
    expect(ws.owner_id).toBe(alice.id);

    // ③ 邀请（默认 member）→ ④ bob 入区
    const invite = await workspaceService.createInvite(alice.id, ws.id, { role: "member" });
    await workspaceService.acceptInvite(bob.id, invite.code);
    const members = await workspaceService.listMembers(alice.id, ws.id);
    expect(members.map((m) => m.username)).toEqual(["alice", "bob"]);

    // ⑤ 建清单 → ⑥ 建重复任务并指派给 bob
    const list = await listService.createList(alice.id, ws.id, { name: "迭代", color: "#3B82F6" });
    const task = await taskService.createTask(alice.id, ws.id, {
      list_id: list.id,
      title: "每日检查",
      assignee_id: bob.id,
      due_at: "2026-09-01T09:00:00.000Z",
      recurrence: { freq: "daily", interval: 1 },
    });

    // ⑦ bob 收到 assigned 通知（🔴 高，手动已读）
    const bobNtfs1 = await notificationService.listNotifications(bob.id, { limit: 10 });
    expect(bobNtfs1.items).toHaveLength(1);
    expect(bobNtfs1.items[0]).toMatchObject({ type: "assigned", level: "high" });

    // ⑧ alice 评论 @bob → mention 通知（待确认）
    const comment = await commentService.createComment(alice.id, task.id, {
      content: "@bob 今天记得检查",
    });
    expect(comment.mentions[0]).toMatchObject({ user_id: bob.id, acked_at: null });

    // ⑨ bob ack 提及确认闭环
    const bobMention = (await notificationService.listNotifications(bob.id, { limit: 10 }))
      .items[0];
    expect(bobMention?.type).toBe("mention");
    const acked = await notificationService.ack(bob.id, bobMention!.id);
    expect(acked.ack_at).not.toBeNull();

    // ack 后评论区回显已确认
    const commentsPage = await commentService.listComments(alice.id, task.id, { limit: 10 });
    expect(commentsPage.items[0]?.mentions[0]?.acked_at).not.toBeNull();

    // ⑩ ack 后再提醒 → 无未确认提及 404；再 @ 一次后可提醒，第二次 429 节流
    await expect(
      notificationService.remindMention(alice.id, task.id, bob.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await commentService.createComment(alice.id, task.id, { content: "@bob 再看下这个" });
    await notificationService.remindMention(alice.id, task.id, bob.id);
    await expect(
      notificationService.remindMention(alice.id, task.id, bob.id),
    ).rejects.toMatchObject({ statusCode: 429, message: "24 小时内只能提醒一次" });

    // ⑪ bob 完成任务 → 同事务生成下一实例（due +1 天，todo，排尾）
    const done = await taskService.updateTask(bob.id, task.id, task.version, { status: "done" });
    expect(done.completed_by).toBe(bob.id);
    const tasksPage = await taskService.queryTasks(bob.id, ws.id, {
      limit: 10,
      sort: "sort_order",
      order: "asc",
    });
    expect(tasksPage.items).toHaveLength(2);
    const successor = tasksPage.items[1];
    expect(successor).toMatchObject({ title: "每日检查", status: "todo", assignee_id: bob.id });
    expect(successor?.due_at).toBe("2026-09-02T09:00:00.000Z");

    // ⑫ events 全链路游标遍历：类型序列完整、id 单调递增
    const allEvents: { id: string; type: string }[] = [];
    let cursor: string | undefined;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 游标分页本质串行：下一页依赖上一页的 next_cursor
      const page = await eventService.listEvents(ws.id, { limit: 3, cursor });
      allEvents.push(...page.items.map((e) => ({ id: e.id, type: e.type })));
      if (page.next_cursor === null) break;
      cursor = page.next_cursor;
    }
    expect(allEvents.map((e) => e.type)).toEqual([
      "workspace.created",
      "member.joined",
      "list.created",
      "task.created", // 建任务
      "comment.created", // 第一条 @bob
      "mention.acked",
      "comment.created", // 第二次 @bob
      "mention.reminded",
      "task.status_changed", // 完成
      "task.created", // 重复任务下一实例
    ]);
    const idNums = allEvents.map((e) => BigInt(e.id));
    for (let i = 1; i < idNums.length; i++) {
      expect(idNums[i]! > idNums[i - 1]!).toBe(true);
    }

    // 通知总数复核：bob = assigned×1 + mention×2（两次 @）+ 再提醒×1
    const bobAll = await db.select().from(notifications).where(eq(notifications.userId, bob.id));
    expect(bobAll).toHaveLength(4);
  });
});
