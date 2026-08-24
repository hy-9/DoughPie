import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { API_PREFIX, ssoPendingSchema, tokenPairSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import { buildTestApp, createTestDb, truncateAll } from "../../tests/helpers.js";
import type { UcClient } from "../uc/uc-client.js";

/**
 * L3 UC SSO 路由：UC_ENABLED=false 时 404（前端据此隐藏入口）；
 * 开启时走 mock UcClient 验证完整链路（禁真实网络）。
 */
describe("UC SSO 路由（L3）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("UC_ENABLED=false（默认独立运行）", () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildTestApp();
    });
    afterAll(async () => {
      await app.close();
    });

    it("sso/start / exchange / link / register 全部 404 NOT_FOUND", async () => {
      for (const path of [
        "/auth/sso/start",
        "/auth/sso/exchange",
        "/auth/sso/link",
        "/auth/sso/register",
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- 逐条断言状态码，串行即可
        const res = await app.inject({ method: "POST", url: `${API_PREFIX}${path}`, payload: {} });
        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe("NOT_FOUND");
      }
    });
  });

  describe("UC_ENABLED=true（mock UC）", () => {
    let app: FastifyInstance;
    const mockUc: UcClient = {
      exchangeCode: async () => ({ accessToken: "uc-access" }),
      getUserinfo: async () => ({
        id: "uc-sub-1",
        username: "alice_uc",
        role: "user",
        client_id: "doughpie",
      }),
      getForceLogoutBefore: async () => null,
    };

    beforeAll(async () => {
      app = await buildTestApp({
        env: {
          uc: {
            enabled: true,
            baseUrl: "http://uc.test",
            clientId: "doughpie",
            clientSecret: "s3cret",
            redirectUri: "http://localhost:5173/auth/callback",
          },
        },
        ucClient: mockUc,
      });
    });
    afterAll(async () => {
      await app.close();
    });

    async function ssoLoginRound() {
      const start = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/start`,
        payload: { mode: "login" },
      });
      expect(start.statusCode).toBe(200);
      const state = new URL(start.json().authorize_url).searchParams.get("state")!;
      return app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/exchange`,
        payload: { code: "auth-code", state },
      });
    }

    it("完整链路：start → exchange 未绑定 pending → sso/register 建号 → 再登直发 token", async () => {
      const first = await ssoLoginRound();
      expect(first.statusCode).toBe(200);
      expect(ssoPendingSchema.safeParse(first.json()).success).toBe(true);
      expect(first.json().suggested_username).toBe("alice_uc");

      const reg = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/register`,
        payload: { pending_token: first.json().pending_token, username: "alice_uc" },
      });
      expect(reg.statusCode).toBe(200);
      expect(tokenPairSchema.safeParse(reg.json()).success).toBe(true);

      // 绑定后再次 SSO：直接发 token
      const second = await ssoLoginRound();
      expect(tokenPairSchema.safeParse(second.json()).success).toBe(true);
    });

    it("sso/link：pending + 本地账密 → 发 token", async () => {
      await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/register`,
        payload: { username: "alice", password: "pass1234" },
      });
      const pending = await ssoLoginRound();
      const res = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/link`,
        payload: {
          pending_token: pending.json().pending_token,
          username: "alice",
          password: "pass1234",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(tokenPairSchema.safeParse(res.json()).success).toBe(true);
    });

    it("bind 模式：未登录发起 → 401；登录后绑定 → { bound: true }", async () => {
      const unauthorized = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/start`,
        payload: { mode: "bind" },
      });
      expect(unauthorized.statusCode).toBe(401);

      const reg = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/register`,
        payload: { username: "alice", password: "pass1234" },
      });
      const accessToken = reg.json().access_token as string;
      const start = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/start`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { mode: "bind" },
      });
      expect(start.statusCode).toBe(200);
      const state = new URL(start.json().authorize_url).searchParams.get("state")!;
      const exchange = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/exchange`,
        payload: { code: "auth-code", state },
      });
      expect(exchange.statusCode).toBe(200);
      expect(exchange.json()).toEqual({ bound: true });
    });

    it("解绑：混合账号 204；UC-only 账号 409 UNBIND_FORBIDDEN", async () => {
      // 混合账号：本地注册 + 绑定 UC
      const reg = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/register`,
        payload: { username: "alice", password: "pass1234" },
      });
      const aliceToken = reg.json().access_token as string;
      const start = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/start`,
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { mode: "bind" },
      });
      const state = new URL(start.json().authorize_url).searchParams.get("state")!;
      await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/exchange`,
        payload: { code: "auth-code", state },
      });
      const unbind = await app.inject({
        method: "DELETE",
        url: `${API_PREFIX}/users/me/identities/uc`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(unbind.statusCode).toBe(204);

      // UC-only 账号：SSO 建号后解绑被保护
      const pending = await ssoLoginRound();
      const regUc = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sso/register`,
        payload: { pending_token: pending.json().pending_token, username: "uc_only" },
      });
      const forbidden = await app.inject({
        method: "DELETE",
        url: `${API_PREFIX}/users/me/identities/uc`,
        headers: { authorization: `Bearer ${regUc.json().access_token}` },
      });
      expect(forbidden.statusCode).toBe(409);
      expect(forbidden.json().code).toBe("UNBIND_FORBIDDEN");
    });
  });
});
