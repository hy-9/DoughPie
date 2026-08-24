import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { API_PREFIX, listSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import {
  authHeader,
  buildTestApp,
  createTestDb,
  registerTestUser,
  truncateAll,
} from "../../tests/helpers.js";

/**
 * L3 清单路由集成测试：CRUD + move + 权限抽查（401/403）。
 */
describe("清单路由（L3）", () => {
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

  /** 建区返回 { wsId }；再建两个清单返回 ids */
  async function setup(token: string): Promise<{ wsId: string; listIds: string[] }> {
    const ws = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(token),
      payload: { name: "清单区" },
    });
    const wsId = ws.json().id as string;
    const listIds: string[] = [];
    for (const name of ["待办", "进行中"]) {
      // oxlint-disable-next-line no-await-in-loop -- 串行创建：排尾 sort_order 依赖创建顺序
      const res = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/workspaces/${wsId}/lists`,
        headers: authHeader(token),
        payload: { name },
      });
      listIds.push(res.json().id as string);
    }
    return { wsId, listIds };
  }

  it("建/列/改/删 + move 全链路（契约形状校验）", async () => {
    const alice = await registerTestUser(app, "alice");
    const { wsId, listIds } = await setup(alice.accessToken);

    const list = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
      headers: authHeader(alice.accessToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(2);
    expect(listSchema.safeParse(list.json()[0]).success).toBe(true);
    expect(list.json()[0].sort_order).toBe(1000);

    const renamed = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/lists/${listIds[0]}`,
      headers: authHeader(alice.accessToken),
      payload: { name: "待办事项", color: "#22C55E" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "待办事项", color: "#22C55E" });

    // move：第二个移到最前
    const moved = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/lists/${listIds[1]}/move`,
      headers: authHeader(alice.accessToken),
      payload: { before_id: listIds[0] },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().sort_order).toBe(500);
    const after = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
      headers: authHeader(alice.accessToken),
    });
    expect(after.json().map((l: { id: string }) => l.id)).toEqual([listIds[1], listIds[0]]);

    // 删除 → 204；列表少一个
    const del = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/lists/${listIds[1]}`,
      headers: authHeader(alice.accessToken),
    });
    expect(del.statusCode).toBe(204);
    const final = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
      headers: authHeader(alice.accessToken),
    });
    expect(final.json()).toHaveLength(1);
  });

  it("权限抽查：未认证 401；viewer 建清单 403；非法颜色 400；move 空落点 400", async () => {
    const alice = await registerTestUser(app, "alice");
    const bob = await registerTestUser(app, "bob");
    const { wsId, listIds } = await setup(alice.accessToken);

    // bob 以 viewer 入区
    const invite = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(alice.accessToken),
      payload: { role: "viewer" },
    });
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code: invite.json().code },
    });

    const anonymous = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
    });
    expect(anonymous.statusCode).toBe(401);

    const viewerCreate = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
      headers: authHeader(bob.accessToken),
      payload: { name: "viewer 建" },
    });
    expect(viewerCreate.statusCode).toBe(403);
    expect(viewerCreate.json().code).toBe("FORBIDDEN");

    const badColor = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/lists`,
      headers: authHeader(alice.accessToken),
      payload: { name: "坏颜色", color: "blue" },
    });
    expect(badColor.statusCode).toBe(400);

    const emptyMove = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/lists/${listIds[0]}/move`,
      headers: authHeader(alice.accessToken),
      payload: {},
    });
    expect(emptyMove.statusCode).toBe(400);
  });
});
