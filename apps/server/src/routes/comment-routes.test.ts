import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { API_PREFIX, commentSchema, subtaskSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import {
  authHeader,
  buildTestApp,
  createTestDb,
  registerTestUser,
  truncateAll,
} from "../../tests/helpers.js";

/**
 * L3 子任务 + 讨论区路由集成测试（P0-9/P0-17）。
 * 覆盖：子任务 CRUD/上限；评论/一级回复/二级拒绝/编辑/删除 tombstone；
 * @提及 → 通知 → ack 确认闭环 → 评论区回显 acked_at（HTTP 全链路）。
 */
describe("子任务与讨论区路由（L3）", () => {
  let app: FastifyInstance;
  let db: Db;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    app = await buildTestApp();
    ({ db, close: closeDb } = createTestDb());
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  /** 建区 + 清单 + 任务 + bob 以 member 入区 */
  async function setup() {
    const alice = await registerTestUser(app, "alice");
    const bob = await registerTestUser(app, "bob");
    const ws = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "讨论区" },
    });
    const wsId = ws.json().id as string;
    const invite = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(alice.accessToken),
      payload: { role: "member" },
    });
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code: invite.json().code },
    });
    const list = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
      headers: authHeader(alice.accessToken),
      payload: { name: "待办" },
    });
    const task = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks`,
      headers: authHeader(alice.accessToken),
      payload: { list_id: list.json().id, title: "联调任务" },
    });
    return { alice, bob, wsId, taskId: task.json().id as string };
  }

  it("子任务 CRUD（契约校验）+ 权限抽查", async () => {
    const { alice, bob, taskId } = await setup();

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/subtasks`,
      headers: authHeader(alice.accessToken),
      payload: { title: "第一步" },
    });
    expect(created.statusCode).toBe(201);
    expect(subtaskSchema.safeParse(created.json()).success).toBe(true);
    const subId = created.json().id as string;

    const checked = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/subtasks/${subId}`,
      headers: authHeader(bob.accessToken),
      payload: { done: true },
    });
    expect(checked.statusCode).toBe(200);
    expect(checked.json().done).toBe(true);

    const list = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/tasks/${taskId}/subtasks`,
      headers: authHeader(bob.accessToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const del = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/subtasks/${subId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(del.statusCode).toBe(204);

    const anonymous = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/tasks/${taskId}/subtasks`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("评论：发表（@提及）→ 一级回复 → 二级 400 → 编辑 → 删除 tombstone", async () => {
    const { alice, bob, taskId } = await setup();

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/comments`,
      headers: authHeader(alice.accessToken),
      payload: { content: "@bob 看一下这个" },
    });
    expect(created.statusCode).toBe(201);
    expect(commentSchema.safeParse(created.json()).success).toBe(true);
    const commentId = created.json().id as string;
    expect(created.json().mentions).toHaveLength(1);
    expect(created.json().mentions[0]).toMatchObject({ user_id: bob.userId, acked_at: null });

    const reply = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/comments`,
      headers: authHeader(bob.accessToken),
      payload: { content: "收到，回复你", parent_id: commentId },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().parent_id).toBe(commentId);

    const nested = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/comments`,
      headers: authHeader(alice.accessToken),
      payload: { content: "二级嵌套", parent_id: reply.json().id },
    });
    expect(nested.statusCode).toBe(400);

    const edited = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/comments/${commentId}`,
      headers: authHeader(alice.accessToken),
      payload: { content: "@bob 改过了" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().edited_at).not.toBeNull();

    // 删除 → tombstone
    const del = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/comments/${commentId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/tasks/${taskId}/comments`,
      headers: authHeader(alice.accessToken),
    });
    const tomb = list.json().items.find((c: { id: string }) => c.id === commentId);
    expect(tomb).toMatchObject({ deleted: true, content: "", mentions: [] });
    // 回复仍在
    expect(list.json().items.some((c: { id: string }) => c.id === reply.json().id)).toBe(true);
  });

  it("提及确认闭环（HTTP 全链路）：@bob → bob 通知中心 → ack → 评论区回显 acked_at → 再提醒 204/429", async () => {
    const { alice, bob, taskId } = await setup();

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/comments`,
      headers: authHeader(alice.accessToken),
      payload: { content: "@bob 请确认收到" },
    });
    const commentId = created.json().id as string;

    // bob 的通知中心出现 mention（unread）
    const ntfs = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/notifications?type=mention&unread_only=true`,
      headers: authHeader(bob.accessToken),
    });
    expect(ntfs.statusCode).toBe(200);
    expect(ntfs.json().items).toHaveLength(1);
    const ntfId = ntfs.json().items[0].id as string;
    expect(ntfs.json().items[0].payload).toMatchObject({ task_id: taskId, comment_id: commentId });

    // ack
    const ack = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/notifications/${ntfId}/ack`,
      headers: authHeader(bob.accessToken),
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().ack_at).not.toBeNull();

    // 评论区回显已确认
    const comments = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/tasks/${taskId}/comments`,
      headers: authHeader(alice.accessToken),
    });
    expect(comments.json().items[0].mentions[0].acked_at).not.toBeNull();

    // ack 后再提醒 → 404（无未确认提及）；alice 再 @ 一次 → 204 → 429 节流
    const remind404 = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/mentions/${bob.userId}/remind`,
      headers: authHeader(alice.accessToken),
    });
    expect(remind404.statusCode).toBe(404);

    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/comments`,
      headers: authHeader(alice.accessToken),
      payload: { content: "@bob 还没看？" },
    });
    const remind = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/mentions/${bob.userId}/remind`,
      headers: authHeader(alice.accessToken),
    });
    expect(remind.statusCode).toBe(204);

    const throttled = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${taskId}/mentions/${bob.userId}/remind`,
      headers: authHeader(alice.accessToken),
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().message).toBe("24 小时内只能提醒一次");
  });
});
