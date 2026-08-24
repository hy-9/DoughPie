import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db.js";
import { events, notifications } from "../models/schema.js";
import { createCommentService } from "./comment-service.js";
import { createNotificationService, type NotificationService } from "./notification-service.js";
import {
  insertList,
  insertMembership,
  insertTask,
  insertUser,
  insertWorkspace,
} from "../../tests/factories.js";
import { createTestDb, truncateAll } from "../../tests/helpers.js";

/**
 * L2 通知业务流（PLAN.md §5）：列表过滤/游标、手动已读、提及确认闭环、再提醒 24h 节流。
 */

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ statusCode: status, code });
}

describe("通知服务（L2）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let svc: NotificationService;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
    svc = createNotificationService({ db });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  /** 搭建：owner/alice(member)/bob(member) + 任务；alice 评论 @bob 产生一条 mention 通知 */
  async function setupWithMention() {
    const owner = await insertUser(db, { username: "owner_u" });
    const alice = await insertUser(db, { username: "alice" });
    const bob = await insertUser(db, { username: "bob" });
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, alice.id, "member");
    await insertMembership(db, ws.id, bob.id, "member");
    const list = await insertList(db, ws.id);
    const task = await insertTask(db, {
      workspaceId: ws.id,
      listId: list.id,
      createdBy: owner.id,
    });
    const commentSvc = createCommentService({ db });
    const comment = await commentSvc.createComment(alice.id, task.id, {
      content: "@bob 看一下",
    });
    const bobNtf = await db.query.notifications.findFirst({
      where: and(eq(notifications.userId, bob.id), eq(notifications.type, "mention")),
    });
    if (!bobNtf) throw new Error("搭建失败：bob 应有一条 mention 通知");
    return { owner, alice, bob, ws, list, task, comment, bobNtf };
  }

  describe("列表与手动已读", () => {
    it("created_at 倒序 + 游标翻页不漏不重；unread_only/level/type 过滤", async () => {
      const { bob, ws, bobNtf } = await setupWithMention();
      // 再造两条：system（mid）与 mention（high）
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: bob.id,
        workspaceId: ws.id,
        type: "system",
        level: "mid",
        entity: "workspace",
        entityId: ws.id,
        payload: {},
      });
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: bob.id,
        workspaceId: ws.id,
        type: "assigned",
        level: "high",
        entity: "task",
        entityId: bobNtf.entityId,
        payload: {},
      });

      const all = await svc.listNotifications(bob.id, { limit: 10 });
      expect(all.items).toHaveLength(3);
      // 倒序验证：逐对比较非递增（避免 sort/reverse 与原数组语义纠缠）
      const times = all.items.map((n) => n.created_at);
      for (let i = 1; i < times.length; i++) {
        expect(times[i - 1]! >= times[i]!).toBe(true);
      }

      const highOnly = await svc.listNotifications(bob.id, { limit: 10, level: "high" });
      expect(highOnly.items).toHaveLength(2);
      const mentionOnly = await svc.listNotifications(bob.id, { limit: 10, type: "mention" });
      expect(mentionOnly.items).toHaveLength(1);

      const p1 = await svc.listNotifications(bob.id, { limit: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p1.next_cursor).not.toBeNull();
      const p2 = await svc.listNotifications(bob.id, {
        limit: 2,
        cursor: p1.next_cursor ?? undefined,
      });
      expect(p2.items).toHaveLength(1);
      expect(p2.next_cursor).toBeNull();
      const ids = new Set([...p1.items, ...p2.items].map((n) => n.id));
      expect(ids.size).toBe(3);

      // unread_only：全部未读时 = 全量；已读一条后少一条
      const unreadBefore = await svc.listNotifications(bob.id, { limit: 10, unread_only: true });
      expect(unreadBefore.items).toHaveLength(3);
      await svc.markRead(bob.id, [bobNtf.id]);
      const unreadAfter = await svc.listNotifications(bob.id, { limit: 10, unread_only: true });
      expect(unreadAfter.items).toHaveLength(2);
    });

    it("手动已读：仅属主生效；幂等；read_at 落库", async () => {
      const { alice, bob, bobNtf } = await setupWithMention();
      // alice 尝试已读 bob 的通知 → 不动
      await svc.markRead(alice.id, [bobNtf.id]);
      let row = await db.query.notifications.findFirst({ where: eq(notifications.id, bobNtf.id) });
      expect(row?.readAt).toBeNull();

      await svc.markRead(bob.id, [bobNtf.id]);
      await svc.markRead(bob.id, [bobNtf.id]); // 幂等
      row = await db.query.notifications.findFirst({ where: eq(notifications.id, bobNtf.id) });
      expect(row?.readAt).not.toBeNull();
    });
  });

  describe("提及确认闭环（§5.5）", () => {
    it("ack：置 read_at+ack_at + 写 mention.acked 事件；幂等", async () => {
      const { bob, ws, task, comment, bobNtf } = await setupWithMention();
      const acked = await svc.ack(bob.id, bobNtf.id);
      expect(acked.read_at).not.toBeNull();
      expect(acked.ack_at).not.toBeNull();

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "mention.acked")));
      expect(evRows).toHaveLength(1);
      expect(evRows[0]?.actorId).toBe(bob.id);
      expect(evRows[0]?.payload).toMatchObject({ task_id: task.id, comment_id: comment.id });

      // 幂等：重复确认返回原状态，事件不重复
      const again = await svc.ack(bob.id, bobNtf.id);
      expect(again.ack_at).toBe(acked.ack_at);
      const evAfter = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "mention.acked")));
      expect(evAfter).toHaveLength(1);
    });

    it("ack：他人通知 → 404；非 mention 类型 → 400", async () => {
      const { alice, bob, ws, bobNtf } = await setupWithMention();
      await expectApiError(svc.ack(alice.id, bobNtf.id), 404, "NOT_FOUND");

      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: bob.id,
        workspaceId: ws.id,
        type: "system",
        level: "mid",
        entity: "workspace",
        entityId: ws.id,
        payload: {},
      });
      const sysNtf = await db.query.notifications.findFirst({
        where: and(eq(notifications.userId, bob.id), eq(notifications.type, "system")),
      });
      await expectApiError(svc.ack(bob.id, sysNtf!.id), 400, "VALIDATION_FAILED");
    });
  });

  describe("再提醒（24h 节流）", () => {
    it("发起人再提醒：写 mention.reminded 事件 + 新发一条 mention 通知", async () => {
      const { alice, bob, ws, task, comment } = await setupWithMention();
      await svc.remindMention(alice.id, task.id, bob.id);

      const evRows = await db
        .select()
        .from(events)
        .where(and(eq(events.workspaceId, ws.id), eq(events.type, "mention.reminded")));
      expect(evRows).toHaveLength(1);
      expect(evRows[0]?.actorId).toBe(alice.id);
      expect(evRows[0]?.payload).toMatchObject({
        task_id: task.id,
        user_id: bob.id,
        comment_id: comment.id,
      });

      const ntfs = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, bob.id),
            eq(notifications.type, "mention"),
            isNull(notifications.ackAt),
          ),
        );
      expect(ntfs).toHaveLength(2); // 原始提及 + 再提醒
      expect(ntfs.some((n) => n.payload["reminded"] === true)).toBe(true);
    });

    it("24h 内重复再提醒 → 429（remindThrottled 文案）", async () => {
      const { alice, bob, task } = await setupWithMention();
      await svc.remindMention(alice.id, task.id, bob.id);
      try {
        await svc.remindMention(alice.id, task.id, bob.id);
        expect.unreachable("应当被节流");
      } catch (err) {
        // 契约错误码 REMIND_THROTTLED（shared ERROR_CODES），HTTP 429
        expect(err).toMatchObject({
          statusCode: 429,
          code: "REMIND_THROTTLED",
          message: "24 小时内只能提醒一次",
        });
      }
    });

    it("无未确认提及 → 404；非提及发起人 → 403；已确认后 → 404", async () => {
      const { owner, alice, bob, task, bobNtf } = await setupWithMention();
      // 404：目标用户在该任务没有未确认提及（无人 @owner）
      await expectApiError(svc.remindMention(alice.id, task.id, owner.id), 404, "NOT_FOUND");
      // 403：bob 有未确认提及，但发起人（actor）不是 owner
      await expectApiError(svc.remindMention(owner.id, task.id, bob.id), 403, "FORBIDDEN");

      // 已 ack 后没有未确认提及 → 404
      await svc.ack(bob.id, bobNtf.id);
      await expectApiError(svc.remindMention(alice.id, task.id, bob.id), 404, "NOT_FOUND");

      // 全新提及后，bob 不能替 alice 提醒（actor 不是 bob）
      await createCommentService({ db }).createComment(alice.id, task.id, {
        content: "@bob 再看一次",
      });
      await expectApiError(svc.remindMention(bob.id, task.id, bob.id), 403, "FORBIDDEN");
    });
  });
});
