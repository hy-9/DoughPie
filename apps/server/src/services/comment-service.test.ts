import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { comments, events, notifications } from "../models/schema.js";
import { createCommentService, type CommentService } from "./comment-service.js";
import { createNotificationService } from "./notification-service.js";
import { createTaskService } from "./task-service.js";
import {
  insertList,
  insertMembership,
  insertTask,
  insertUser,
  insertWorkspace,
} from "../../tests/factories.js";
import { createTestDb, truncateAll } from "../../tests/helpers.js";

/**
 * L2 讨论区业务流（P0-17，PLAN.md §5.5/§6.1）：
 * 一级回复 / state_at_comment 快照 / 编辑不限期 / tombstone 删除 /
 * @提及（仅成员、排除作者、去重）/ 提及通知与 acked_at 回显闭环。
 */

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ statusCode: status, code });
}

describe("评论服务（L2）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let svc: CommentService;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
    svc = createCommentService({ db });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function setup() {
    const owner = await insertUser(db, { username: "owner_u" });
    const alice = await insertUser(db, { username: "alice", displayName: "爱丽丝" });
    const bob = await insertUser(db, { username: "bob" });
    const outsider = await insertUser(db, { username: "outsider" });
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, alice.id, "member");
    await insertMembership(db, ws.id, bob.id, "member");
    const list = await insertList(db, ws.id);
    const task = await insertTask(db, { workspaceId: ws.id, listId: list.id, createdBy: owner.id });
    return { owner, alice, bob, outsider, ws, list, task };
  }

  it("发表：state_at_comment 记录任务当前状态；写 comment.created 事件", async () => {
    const { alice, ws, task } = await setup();
    // 任务置 doing 后发表评论，快照应为 doing
    await createTaskService({ db }).updateTask(alice.id, task.id, 1, { status: "doing" });

    const c = await svc.createComment(alice.id, task.id, { content: "开始处理了" });
    expect(c.state_at_comment).toBe("doing");
    expect(c.edited_at).toBeNull();
    expect(c.deleted).toBe(false);
    expect(c.author_username).toBe("alice");

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "comment.created")));
    expect(evRows).toHaveLength(1);
    expect(evRows[0]?.payload).toMatchObject({ task_id: task.id, state_at_comment: "doing" });
  });

  it("一级回复：正常；二级嵌套 → 400；回复不存在的/已删除的评论 → 400；跨任务 parent → 400", async () => {
    const { alice, ws, list, task } = await setup();
    const top = await svc.createComment(alice.id, task.id, { content: "顶层" });
    const reply = await svc.createComment(alice.id, task.id, {
      content: "回复",
      parent_id: top.id,
    });
    expect(reply.parent_id).toBe(top.id);

    await expectApiError(
      svc.createComment(alice.id, task.id, { content: "二级", parent_id: reply.id }),
      400,
      "VALIDATION_FAILED",
    );
    await expectApiError(
      svc.createComment(alice.id, task.id, {
        content: "不存在",
        parent_id: crypto.randomUUID(),
      }),
      400,
      "VALIDATION_FAILED",
    );

    // 其他任务的顶层评论不能作为 parent
    const task2 = await insertTask(db, {
      workspaceId: ws.id,
      listId: list.id,
      createdBy: alice.id,
    });
    const foreign = await svc.createComment(alice.id, task2.id, { content: "别任务的" });
    await expectApiError(
      svc.createComment(alice.id, task.id, { content: "跨任务", parent_id: foreign.id }),
      400,
      "VALIDATION_FAILED",
    );

    // 已删除的顶层评论不可回复
    await svc.deleteComment(alice.id, top.id);
    await expectApiError(
      svc.createComment(alice.id, task.id, { content: "回复墓碑", parent_id: top.id }),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("@提及：成员收 mention 通知（🔴 深链 payload）；非成员/作者本人/重复 @ 均不产生通知", async () => {
    const { alice, bob, task } = await setup();
    // @alice（作者本人）@bob @outsider（非成员）@不存在 @bob（重复）
    const c = await svc.createComment(alice.id, task.id, {
      content: "@alice @bob @outsider @no_such_user @bob 看一下",
    });

    // DTO mentions 仅含 bob（排除作者与非成员，去重）
    expect(c.mentions).toHaveLength(1);
    expect(c.mentions[0]).toMatchObject({ user_id: bob.id, username: "bob", acked_at: null });

    const bobNtfs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, bob.id), eq(notifications.type, "mention")));
    expect(bobNtfs).toHaveLength(1);
    expect(bobNtfs[0]?.level).toBe("high");
    expect(bobNtfs[0]?.actorId).toBe(alice.id);
    expect(bobNtfs[0]?.payload).toMatchObject({ task_id: task.id, comment_id: c.id });
    expect(typeof bobNtfs[0]?.payload["excerpt"]).toBe("string");

    // 作者本人不产生任何通知
    const authorNtfs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, alice.id));
    expect(authorNtfs).toHaveLength(0);
  });

  it("编辑：edited_at 标记；新增提及补发通知；非作者 → 403", async () => {
    const { alice, bob, task } = await setup();
    const c = await svc.createComment(alice.id, task.id, { content: "初版" });

    const edited = await svc.updateComment(alice.id, c.id, { content: "改版 @bob 看下" });
    expect(edited.edited_at).not.toBeNull();
    expect(edited.mentions.map((m) => m.user_id)).toEqual([bob.id]);

    const bobNtfs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, bob.id), eq(notifications.type, "mention")));
    expect(bobNtfs).toHaveLength(1);

    // 再编辑 @ 同一人不重复通知
    await svc.updateComment(alice.id, c.id, { content: "再改 @bob" });
    const after = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, bob.id), eq(notifications.type, "mention")));
    expect(after).toHaveLength(1);

    await expectApiError(svc.updateComment(bob.id, c.id, { content: "越权" }), 403, "FORBIDDEN");

    const evRows = await db.select().from(events).where(eq(events.type, "comment.updated"));
    expect(evRows).toHaveLength(2);
  });

  it("删除：tombstone（content 置空、mentions 清空、deleted=true），回复仍在；非作者 → 403", async () => {
    const { alice, bob, task } = await setup();
    const top = await svc.createComment(alice.id, task.id, { content: "要删的 @bob" });
    const reply = await svc.createComment(bob.id, task.id, {
      content: "回复保留",
      parent_id: top.id,
    });

    await expectApiError(svc.deleteComment(bob.id, top.id), 403, "FORBIDDEN");

    await svc.deleteComment(alice.id, top.id);
    const page = await svc.listComments(alice.id, task.id, { limit: 50 });
    expect(page.items).toHaveLength(2);
    const tomb = page.items.find((c) => c.id === top.id);
    expect(tomb).toMatchObject({ deleted: true, content: "", mentions: [] });
    const kept = page.items.find((c) => c.id === reply.id);
    expect(kept?.content).toBe("回复保留");

    // 已删评论再删/再编辑 → 404
    await expectApiError(svc.deleteComment(alice.id, top.id), 404, "NOT_FOUND");
    await expectApiError(svc.updateComment(alice.id, top.id, { content: "x" }), 404, "NOT_FOUND");

    // DB 层仍保留原内容（tombstone 而非物理删除）
    const row = await db.query.comments.findFirst({ where: eq(comments.id, top.id) });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.content).toBe("要删的 @bob");
  });

  it("mentions 回显 acked_at：被@者 ack 后评论区显示已确认（PLAN.md §5.5）", async () => {
    const { alice, bob, task } = await setup();
    await svc.createComment(alice.id, task.id, { content: "@bob 请确认" });

    // ack 前：待确认
    const before = await svc.listComments(alice.id, task.id, { limit: 50 });
    expect(before.items[0]?.mentions[0]?.acked_at).toBeNull();

    // bob 找到自己的 mention 通知并确认
    const ntfSvc = createNotificationService({ db });
    const bobNtfs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, bob.id), eq(notifications.type, "mention")));
    const ntf = bobNtfs[0];
    expect(ntf).toBeDefined();
    await ntfSvc.ack(bob.id, ntf!.id);

    const after = await svc.listComments(alice.id, task.id, { limit: 50 });
    const mention = after.items[0]?.mentions[0];
    expect(mention?.user_id).toBe(bob.id);
    expect(mention?.acked_at).not.toBeNull();
  });

  it("列表按发表时间升序 + 游标分页不漏不重", async () => {
    const { alice, task } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      // oxlint-disable-next-line no-await-in-loop -- 串行创建：保证 created_at 先后即内容顺序
      const c = await svc.createComment(alice.id, task.id, { content: `第${i}条` });
      ids.push(c.id);
    }

    const p1 = await svc.listComments(alice.id, task.id, { limit: 2 });
    expect(p1.items.map((c) => c.id)).toEqual(ids.slice(0, 2));
    const p2 = await svc.listComments(alice.id, task.id, {
      limit: 2,
      cursor: p1.next_cursor ?? undefined,
    });
    expect(p2.items.map((c) => c.id)).toEqual(ids.slice(2, 4));
    const p3 = await svc.listComments(alice.id, task.id, {
      limit: 2,
      cursor: p2.next_cursor ?? undefined,
    });
    expect(p3.items.map((c) => c.id)).toEqual(ids.slice(4));
    expect(p3.next_cursor).toBeNull();
  });

  it("viewer 可读不可评；非成员 403；任务软删后 404", async () => {
    const { alice, outsider, ws, task } = await setup();
    const viewer = await insertUser(db, { username: "viewer_u" });
    await insertMembership(db, ws.id, viewer.id, "viewer");
    await svc.createComment(alice.id, task.id, { content: "可见" });

    expect((await svc.listComments(viewer.id, task.id, { limit: 50 })).items).toHaveLength(1);
    await expectApiError(
      svc.createComment(viewer.id, task.id, { content: "不行" }),
      403,
      "FORBIDDEN",
    );
    await expectApiError(svc.listComments(outsider.id, task.id, { limit: 50 }), 403, "FORBIDDEN");

    await createTaskService({ db }).deleteTask(alice.id, task.id);
    await expectApiError(svc.listComments(alice.id, task.id, { limit: 50 }), 404, "NOT_FOUND");
    await expectApiError(svc.createComment(alice.id, task.id, { content: "x" }), 404, "NOT_FOUND");
  });
});
