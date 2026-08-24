import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { API_PREFIX, eventEnvelopeSchema, notificationSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import {
  authHeader,
  buildTestApp,
  createTestDb,
  registerTestUser,
  truncateAll,
} from "../../tests/helpers.js";

/**
 * L3 通知路由 + events 断线补齐路由集成测试（PLAN.md §4/§5）。
 * 覆盖：通知列表/过滤/手动已读/ack 权限；events 游标分页（id 字符串化防 int8 精度丢失）。
 */
describe("通知与 events 路由（L3）", () => {
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

  /** alice 建区 + 邀请 bob(member) + 建清单任务 + alice 评论 @bob（产生 mention 通知） */
  async function setupWithMention() {
    const alice = await registerTestUser(app, "alice");
    const bob = await registerTestUser(app, "bob");
    const ws = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "通知区" },
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
      payload: { list_id: list.json().id, title: "通知任务" },
    });
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${task.json().id}/comments`,
      headers: authHeader(alice.accessToken),
      payload: { content: "@bob 看" },
    });
    return { alice, bob, wsId, taskId: task.json().id as string };
  }

  it("通知列表：契约校验 + unread_only 过滤 + 手动已读", async () => {
    const { bob } = await setupWithMention();

    const list = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/notifications`,
      headers: authHeader(bob.accessToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(notificationSchema.safeParse(list.json().items[0]).success).toBe(true);
    const ntfId = list.json().items[0].id as string;

    // 手动已读 → unread_only 后为空
    const read = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/notifications/read`,
      headers: authHeader(bob.accessToken),
      payload: { ids: [ntfId] },
    });
    expect(read.statusCode).toBe(204);

    const unread = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/notifications?unread_only=true`,
      headers: authHeader(bob.accessToken),
    });
    expect(unread.json().items).toHaveLength(0);

    const all = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/notifications`,
      headers: authHeader(bob.accessToken),
    });
    expect(all.json().items[0].read_at).not.toBeNull();
  });

  it("ack 权限：他人通知 → 404；未认证 → 401；read 的 ids 非法 → 400", async () => {
    const { alice, bob } = await setupWithMention();
    const list = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/notifications`,
      headers: authHeader(bob.accessToken),
    });
    const ntfId = list.json().items[0].id as string;

    // alice 对 bob 的通知 ack → 404
    const wrong = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/notifications/${ntfId}/ack`,
      headers: authHeader(alice.accessToken),
    });
    expect(wrong.statusCode).toBe(404);

    const anonymous = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/notifications/${ntfId}/ack`,
    });
    expect(anonymous.statusCode).toBe(401);

    const badRead = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/notifications/read`,
      headers: authHeader(bob.accessToken),
      payload: { ids: [] },
    });
    expect(badRead.statusCode).toBe(400);
  });

  it("events 断线补齐：游标翻页升序不漏不重；非成员 403；未认证 401", async () => {
    const { alice, bob, wsId } = await setupWithMention();
    // 以上流程产生：workspace.created / member.joined / list.created / task.created / comment.created
    const carol = await registerTestUser(app, "carol");

    const p1 = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/events?limit=2`,
      headers: authHeader(alice.accessToken),
    });
    expect(p1.statusCode).toBe(200);
    expect(p1.json().items).toHaveLength(2);
    expect(eventEnvelopeSchema.safeParse(p1.json().items[0]).success).toBe(true);
    // id 为 string（防 int8 精度丢失）
    expect(typeof p1.json().items[0].id).toBe("string");
    expect(p1.json().items[0].type).toBe("workspace.created");

    // 游标翻页直到尽头
    const seen: string[] = p1.json().items.map((e: { id: string }) => e.id);
    let cursor: string | null = p1.json().next_cursor;
    while (cursor !== null) {
      // oxlint-disable-next-line no-await-in-loop -- 游标分页本质串行：下一页依赖上一页的 next_cursor
      const page = await app.inject({
        method: "GET",
        url: `${API_PREFIX}/workspaces/${wsId}/events?limit=2&cursor=${cursor}`,
        headers: authHeader(alice.accessToken),
      });
      expect(page.statusCode).toBe(200);
      seen.push(...page.json().items.map((e: { id: string }) => e.id));
      cursor = page.json().next_cursor;
    }
    // 至少 5 条且无重复、升序
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(new Set(seen).size).toBe(seen.length);
    const asBig = seen.map((s) => BigInt(s));
    for (let i = 1; i < asBig.length; i++) {
      expect(asBig[i]! > asBig[i - 1]!).toBe(true);
    }

    // viewer bob 可读 events；非成员 carol → 403
    const viewerRead = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/events`,
      headers: authHeader(bob.accessToken),
    });
    expect(viewerRead.statusCode).toBe(200);
    const outsider = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/events`,
      headers: authHeader(carol.accessToken),
    });
    expect(outsider.statusCode).toBe(403);

    const anonymous = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/events`,
    });
    expect(anonymous.statusCode).toBe(401);

    // 非法游标 → 400
    const badCursor = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/events?cursor=abc`,
      headers: authHeader(alice.accessToken),
    });
    expect(badCursor.statusCode).toBe(400);
  });
});
