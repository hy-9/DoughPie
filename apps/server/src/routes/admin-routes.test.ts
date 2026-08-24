import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { API_PREFIX, adminResetPasswordResultSchema, userSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import { buildTestApp, createTestDb, truncateAll } from "../../tests/helpers.js";

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * L3 实例管理路由（P0-16）：仅实例 admin 可达；禁用/重置密码/末位保护。
 */
describe("实例管理路由（L3）", () => {
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

  /** 注册 admin（首用户）+ 一个普通用户，返回双方 token */
  async function setupAdminAndUser() {
    const adminRes = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/register`,
      payload: { username: "admin1", password: "pass1234" },
    });
    const userRes = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/register`,
      payload: { username: "alice", password: "pass1234" },
    });
    const adminToken = adminRes.json().access_token as string;
    const userToken = userRes.json().access_token as string;
    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(userToken),
    });
    return { adminToken, userToken, userId: me.json().id as string };
  }

  it("权限矩阵：匿名 401 / 普通用户 403 / admin 200 列表", async () => {
    const { adminToken, userToken } = await setupAdminAndUser();

    const anonymous = await app.inject({ method: "GET", url: `${API_PREFIX}/admin/users` });
    expect(anonymous.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/admin/users`,
      headers: authHeader(userToken),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("FORBIDDEN");

    const ok = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/admin/users`,
      headers: authHeader(adminToken),
    });
    expect(ok.statusCode).toBe(200);
    const list = ok.json();
    expect(list).toHaveLength(2);
    for (const item of list) expect(userSchema.safeParse(item).success).toBe(true);
  });

  it("禁用用户 → 200，且目标用户旧 access 立即失效（403 USER_DISABLED）", async () => {
    const { adminToken, userToken, userId } = await setupAdminAndUser();
    const res = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/admin/users/${userId}`,
      headers: authHeader(adminToken),
      payload: { status: "disabled" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("disabled");

    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(userToken),
    });
    expect(me.statusCode).toBe(403);
    expect(me.json().code).toBe("USER_DISABLED");
  });

  it("降级最后一个 admin → 409 LAST_ADMIN", async () => {
    const adminRes = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/register`,
      payload: { username: "admin1", password: "pass1234" },
    });
    const adminToken = adminRes.json().access_token as string;
    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(adminToken),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/admin/users/${me.json().id}`,
      headers: authHeader(adminToken),
      payload: { role: "user" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: "LAST_ADMIN", message: "至少需要保留一名管理员" });
  });

  it("重置密码 → 200 一次性临时密码，目标用户会话全吊销", async () => {
    const { adminToken, userToken, userId } = await setupAdminAndUser();
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/admin/users/${userId}/reset-password`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(adminResetPasswordResultSchema.safeParse(res.json()).success).toBe(true);

    // 旧 access 因会话吊销立即失效
    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(userToken),
    });
    expect(me.statusCode).toBe(401);

    // 临时密码可登录
    const login = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/login`,
      payload: { username: "alice", password: res.json().temp_password },
    });
    expect(login.statusCode).toBe(200);
  });

  it("非法用户 id → 400 VALIDATION_FAILED", async () => {
    const { adminToken } = await setupAdminAndUser();
    const res = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/admin/users/not-a-uuid`,
      headers: authHeader(adminToken),
      payload: { status: "disabled" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
