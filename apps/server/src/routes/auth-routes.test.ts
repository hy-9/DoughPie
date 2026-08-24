import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { API_PREFIX, tokenPairSchema, userSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import { buildTestApp, createTestDb, truncateAll } from "../../tests/helpers.js";
import { insertUser } from "../../tests/factories.js";

const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * L3 认证/用户路由集成测试（app.inject + 真实测试 PG，每业务流至少 1 条）。
 */
describe("认证与用户路由（L3）", () => {
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

  async function registerUser(username = "alice", password = "pass1234") {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/register`,
      payload: { username, password },
    });
    return res;
  }

  it("注册 → 201 TokenPair；首个注册用户为实例 admin", async () => {
    const res = await registerUser();
    expect(res.statusCode).toBe(201);
    expect(tokenPairSchema.safeParse(res.json()).success).toBe(true);

    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(res.json().access_token),
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(userSchema.safeParse(body).success).toBe(true);
    expect(body.role).toBe("admin");

    // 第二个注册用户为普通 user
    const second = await registerUser("bob");
    const me2 = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(second.json().access_token),
    });
    expect(me2.json().role).toBe("user");
  });

  it("弱密码注册 → 400 VALIDATION_FAILED 扁平结构", async () => {
    const res = await registerUser("alice", "short");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "VALIDATION_FAILED", message: "提交的内容不符合要求" });
  });

  it("重复用户名 → 409 USERNAME_TAKEN", async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("USERNAME_TAKEN");
    expect(res.json().message).toBe("该用户名已被占用");
  });

  it("登录成功 → 200 TokenPair；错误密码 → 401 INVALID_CREDENTIALS", async () => {
    await registerUser();
    const ok = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/login`,
      payload: { username: "alice", password: "pass1234" },
    });
    expect(ok.statusCode).toBe(200);
    expect(tokenPairSchema.safeParse(ok.json()).success).toBe(true);

    const bad = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/login`,
      payload: { username: "alice", password: "wrong123" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ code: "INVALID_CREDENTIALS", message: "用户名或密码不正确" });
  });

  it("未登录访问 /users/me → 401；携带合法 access → 200", async () => {
    const anonymous = await app.inject({ method: "GET", url: `${API_PREFIX}/users/me` });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe("UNAUTHORIZED");

    const { json } = await registerUser();
    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(json().access_token),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe("alice");
  });

  it("PATCH /users/me 修改昵称", async () => {
    const { json } = await registerUser();
    const res = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(json().access_token),
      payload: { display_name: "新昵称" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().display_name).toBe("新昵称");
  });

  it("refresh 轮换：新对可用，旧串再用 → 401 REFRESH_REUSED", async () => {
    const { json } = await registerUser();
    const pair = json();
    const refreshed = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/refresh`,
      payload: { refresh_token: pair.refresh_token },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(tokenPairSchema.safeParse(refreshed.json()).success).toBe(true);

    const reused = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/refresh`,
      payload: { refresh_token: pair.refresh_token },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json().code).toBe("REFRESH_REUSED");
    expect(reused.json().message).toBe("登录状态异常，已为你注销所有会话，请重新登录");
  });

  it("logout → 204，该会话 refresh 失效", async () => {
    const { json } = await registerUser();
    const pair = json();
    const out = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/logout`,
      payload: { refresh_token: pair.refresh_token },
    });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/refresh`,
      payload: { refresh_token: pair.refresh_token },
    });
    expect(after.statusCode).toBe(401);
  });

  it("logout-all → 204，全部会话失效", async () => {
    const { json } = await registerUser();
    const pair = json();
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/logout-all`,
      headers: authHeader(pair.access_token),
    });
    expect(res.statusCode).toBe(204);
    // 会话吊销后旧 access 立即失效
    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(pair.access_token),
    });
    expect(me.statusCode).toBe(401);
  });

  it("改密 → 204 全端下线：旧 access 与 refresh 立即失效，新密码可登录", async () => {
    const { json } = await registerUser();
    const pair = json();
    const res = await app.inject({
      method: "PUT",
      url: `${API_PREFIX}/users/me/password`,
      headers: authHeader(pair.access_token),
      payload: { old_password: "pass1234", new_password: "newpass99" },
    });
    expect(res.statusCode).toBe(204);

    const me = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/me`,
      headers: authHeader(pair.access_token),
    });
    expect(me.statusCode).toBe(401);

    const relogin = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/login`,
      payload: { username: "alice", password: "newpass99" },
    });
    expect(relogin.statusCode).toBe(200);
  });

  it("UC-only 账号（无本地密码）免 old_password 设置本地密码", async () => {
    // 直接落库一个 UC-only 账号（等价于 SSO 建号产物：password_hash 为空）
    const ucOnly = await insertUser(db, { username: "uc_user" });
    const { tokens } = await app.services.tokenService.issueSession(ucOnly.id);

    const res = await app.inject({
      method: "PUT",
      url: `${API_PREFIX}/users/me/password`,
      headers: authHeader(tokens.access_token),
      payload: { new_password: "newpass99" },
    });
    expect(res.statusCode).toBe(204);

    const login = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/login`,
      payload: { username: "uc_user", password: "newpass99" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("未知路由 → 404 NOT_FOUND 扁平结构", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/no-such-route` });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});
