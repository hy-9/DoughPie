import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { API_PREFIX, taskSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import {
  authHeader,
  buildTestApp,
  createTestDb,
  registerTestUser,
  truncateAll,
} from "../../tests/helpers.js";

/**
 * L3 任务路由集成测试（P0-4/P0-14/P0-15）：
 * CRUD + If-Match 乐观锁（400/409）+ 软删除 + 查询 + move + 权限抽查。
 * 业务细节（重复任务/状态机/筛选矩阵）由 L2 覆盖，路由层抽查主链路。
 */
describe("任务路由（L3）", () => {
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

  async function setup(): Promise<{ token: string; userId: string; wsId: string; listId: string }> {
    const alice = await registerTestUser(app, "alice");
    const ws = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "任务区" },
    });
    const wsId = ws.json().id as string;
    const list = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
      headers: authHeader(alice.accessToken),
      payload: { name: "待办" },
    });
    return { token: alice.accessToken, userId: alice.userId, wsId, listId: list.json().id };
  }

  function createTask(token: string, wsId: string, listId: string, title: string) {
    return app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks`,
      headers: authHeader(token),
      payload: { list_id: listId, title },
    });
  }

  it("建任务 201（契约校验）→ 列表/单条 → PATCH 完成 → 删除 → 404", async () => {
    const { token, wsId, listId } = await setup();

    const created = await createTask(token, wsId, listId, "写周报");
    expect(created.statusCode).toBe(201);
    expect(taskSchema.safeParse(created.json()).success).toBe(true);
    const taskId = created.json().id as string;
    expect(created.json()).toMatchObject({ status: "todo", version: 1, priority: "none" });

    const list = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks`,
      headers: authHeader(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().next_cursor).toBeNull();

    const got = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/tasks/${taskId}`,
      headers: authHeader(token),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().title).toBe("写周报");

    // 完成：If-Match 命中
    const done = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/tasks/${taskId}`,
      headers: { ...authHeader(token), "if-match": "1" },
      payload: { status: "done" },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ status: "done", version: 2 });
    expect(done.json().completed_by).not.toBeNull();

    // 软删 → 204；再取 → 404
    const del = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/tasks/${taskId}`,
      headers: authHeader(token),
    });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/tasks/${taskId}`,
      headers: authHeader(token),
    });
    expect(gone.statusCode).toBe(404);
  });

  it("乐观锁：缺 If-Match → 400；版本不符 → 409 VERSION_CONFLICT", async () => {
    const { token, wsId, listId } = await setup();
    const taskId = (await createTask(token, wsId, listId, "并发")).json().id as string;

    const noHeader = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/tasks/${taskId}`,
      headers: authHeader(token),
      payload: { title: "无锁" },
    });
    expect(noHeader.statusCode).toBe(400);
    expect(noHeader.json().code).toBe("VALIDATION_FAILED");

    const stale = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/tasks/${taskId}`,
      headers: { ...authHeader(token), "if-match": "99" },
      payload: { title: "旧版本" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      code: "VERSION_CONFLICT",
      message: "内容已被他人修改，已为你刷新最新数据",
    });
  });

  it("查询：view=mine / q 搜索 / 分页游标；非法 query → 400", async () => {
    const { token, userId, wsId, listId } = await setup();
    for (const title of ["写周报", "写月报", "开会"]) {
      // oxlint-disable-next-line no-await-in-loop -- 串行创建：排尾 sort_order 依赖创建顺序
      await createTask(token, wsId, listId, title);
    }

    const mine = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks?view=mine`,
      headers: authHeader(token),
    });
    expect(mine.statusCode).toBe(200);
    // 未指派不算 mine
    expect(mine.json().items).toHaveLength(0);

    const search = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks?q=${encodeURIComponent("周报")}`,
      headers: authHeader(token),
    });
    expect(search.json().items.map((t: { title: string }) => t.title)).toEqual(["写周报"]);

    // 游标翻页
    const p1 = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks?limit=2`,
      headers: authHeader(token),
    });
    expect(p1.json().items).toHaveLength(2);
    const p2 = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks?limit=2&cursor=${encodeURIComponent(p1.json().next_cursor)}`,
      headers: authHeader(token),
    });
    expect(p2.json().items).toHaveLength(1);
    expect(p2.json().next_cursor).toBeNull();

    const bad = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks?limit=0`,
      headers: authHeader(token),
    });
    expect(bad.statusCode).toBe(400);

    // 建一个指派给自己的任务后 view=mine 命中
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks`,
      headers: authHeader(token),
      payload: { list_id: listId, title: "我的", assignee_id: userId },
    });
    const mine2 = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks?view=mine`,
      headers: authHeader(token),
    });
    expect(mine2.json().items.map((t: { title: string }) => t.title)).toEqual(["我的"]);
  });

  it("move 列内排序；权限抽查：未认证 401 / viewer 403 / 非成员 403", async () => {
    const { token, wsId, listId } = await setup();
    const bob = await registerTestUser(app, "bob");
    const carol = await registerTestUser(app, "carol");
    const invite = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(token),
      payload: { role: "viewer" },
    });
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code: invite.json().code },
    });

    const t1 = (await createTask(token, wsId, listId, "一")).json().id as string;
    const t2 = (await createTask(token, wsId, listId, "二")).json().id as string;

    const moved = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tasks/${t2}/move`,
      headers: authHeader(token),
      payload: { before_id: t1 },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().sort_order).toBe(500);

    const anonymous = await app.inject({ method: "GET", url: `${API_PREFIX}/tasks/${t1}` });
    expect(anonymous.statusCode).toBe(401);

    const viewerWrite = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/tasks/${t1}`,
      headers: { ...authHeader(bob.accessToken), "if-match": "1" },
      payload: { title: "viewer 改" },
    });
    expect(viewerWrite.statusCode).toBe(403);

    const outsiderRead = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks`,
      headers: authHeader(carol.accessToken),
    });
    expect(outsiderRead.statusCode).toBe(403);
  });

  it("重复任务全链路（路由层抽查）：daily 完成 → 下一实例自动出现", async () => {
    const { token, wsId, listId } = await setup();
    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks`,
      headers: authHeader(token),
      payload: {
        list_id: listId,
        title: "每日站会",
        due_at: "2026-09-01T09:00:00.000Z",
        recurrence: { freq: "daily", interval: 1 },
      },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;

    const done = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/tasks/${taskId}`,
      headers: { ...authHeader(token), "if-match": "1" },
      payload: { status: "done" },
    });
    expect(done.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/tasks`,
      headers: authHeader(token),
    });
    expect(list.json().items).toHaveLength(2);
    const successor = list.json().items.find((t: { id: string }) => t.id !== taskId) as {
      due_at: string;
      status: string;
    };
    expect(successor.due_at).toBe("2026-09-02T09:00:00.000Z");
    expect(successor.status).toBe("todo");
  });
});
