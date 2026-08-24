import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ssoPendingSchema, tokenPairSchema, PENDING_SSO_TTL_MINUTES } from "@doughpie/shared";
import type { Db } from "../db.js";
import { createTestDb, testEnv, truncateAll } from "../../tests/helpers.js";
import { insertUcIdentity, insertUser } from "../../tests/factories.js";
import { ApiError } from "../lib/api-error.js";
import type { UcClient } from "../uc/uc-client.js";
import { createAuthService } from "./auth-service.js";
import { LoginGuard } from "./login-guard.js";
import { createSsoService, createSsoStateStore, type SsoService } from "./sso-service.js";
import { createTokenService } from "./token-service.js";

/**
 * L2 UC SSO 业务流（backend.md §2.4 先问后建 + §2.9 契约要点）。
 * UC 客户端一律 mock，禁止真实网络。
 */
describe("ssoService UC 统一认证（L2）", () => {
  let db: Db;
  let close: () => Promise<void>;
  let sso: SsoService;
  let ucCalls: { method: string; params?: unknown }[];
  const ctx = { ip: "10.0.0.1", deviceInfo: "vitest" };

  /** 默认 mock：换票成功，userinfo 返回 uc-sub-1/alice_uc */
  function mockUcClient(overrides?: Partial<UcClient>): UcClient {
    return {
      exchangeCode: async (params) => {
        ucCalls.push({ method: "exchangeCode", params });
        return { accessToken: "uc-access-token" };
      },
      getUserinfo: async (token) => {
        ucCalls.push({ method: "getUserinfo", params: token });
        return { id: "uc-sub-1", username: "alice_uc", role: "user", client_id: "doughpie" };
      },
      getForceLogoutBefore: async () => null,
      ...overrides,
    };
  }

  function buildService(ucClient: UcClient, stateNow?: () => number) {
    const env = testEnv();
    const tokens = createTokenService({
      db,
      jwtSecret: env.jwtSecret,
      accessTokenTtlSec: 1800,
      refreshTokenTtlDays: 30,
    });
    const guard = new LoginGuard({ maxFailures: 10, lockMinutes: 15 });
    const auth = createAuthService({
      db,
      tokenService: tokens,
      loginGuard: guard,
      loginLockMinutes: 15,
    });
    return createSsoService({
      db,
      tokenService: tokens,
      authService: auth,
      jwtSecret: env.jwtSecret,
      uc: env.uc,
      ucClient,
      stateStore: createSsoStateStore(stateNow),
    });
  }

  beforeEach(async () => {
    ({ db, close } = createTestDb());
    await truncateAll(db);
    ucCalls = [];
    sso = buildService(mockUcClient());
  });

  afterEach(async () => {
    await close();
  });

  describe("sso/start", () => {
    it("返回 authorize_url：client_id/redirect_uri/code_challenge(S256)/state，无 response_type", async () => {
      const { authorize_url } = await sso.start({ mode: "login" });
      const url = new URL(authorize_url);
      expect(url.origin + url.pathname).toBe("http://uc.test/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("doughpie");
      expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5173/auth/callback");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBeTruthy();
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.has("response_type")).toBe(false);
    });
  });

  describe("sso/exchange", () => {
    it("已绑定身份 → 直接发 TokenPair", async () => {
      const user = await insertUser(db, { username: "alice", password: "pass1234" });
      await insertUcIdentity(db, user.id, "uc-sub-1");
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;

      const result = await sso.exchange({ code: "auth-code", state }, ctx);
      expect(result.kind).toBe("tokens");
      if (result.kind === "tokens") {
        expect(tokenPairSchema.safeParse(result.tokens).success).toBe(true);
        expect(result.user.id).toBe(user.id);
      }
      // 换票 code_verifier 与 start 生成的 challenge 配对（调用了 UC）
      expect(ucCalls.map((c) => c.method)).toEqual(["exchangeCode", "getUserinfo"]);
    });

    it("未绑定身份 → SsoPending（5 分钟一次性票据，含 uc_sub 与预填用户名）", async () => {
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const result = await sso.exchange({ code: "auth-code", state }, ctx);
      expect(result.kind).toBe("pending");
      if (result.kind === "pending") {
        expect(ssoPendingSchema.safeParse(result.pending).success).toBe(true);
        expect(result.pending.suggested_username).toBe("alice_uc");
        expect(result.pending.expires_in).toBe(PENDING_SSO_TTL_MINUTES * 60);
        const claims = decodeJwt(result.pending.pending_token);
        expect(claims.purpose).toBe("pending_sso");
        expect(claims.uc_sub).toBe("uc-sub-1");
      }
    });

    it("state 一次性：第二次使用 → PENDING_SSO_EXPIRED", async () => {
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      await sso.exchange({ code: "auth-code", state }, ctx);
      const err = await sso.exchange({ code: "auth-code", state }, ctx).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("PENDING_SSO_EXPIRED");
    });

    it("state 无效 → PENDING_SSO_EXPIRED", async () => {
      const err = await sso.exchange({ code: "c", state: "no-such-state" }, ctx).catch((e) => e);
      expect((err as ApiError).code).toBe("PENDING_SSO_EXPIRED");
    });

    it("state 超过 10 分钟 → PENDING_SSO_EXPIRED", async () => {
      let now = 1_000_000;
      sso = buildService(mockUcClient(), () => now);
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      now += 10 * 60 * 1000 + 1;
      const err = await sso.exchange({ code: "c", state }, ctx).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("PENDING_SSO_EXPIRED");
    });

    it("bind 模式：绑定到当前登录用户 → { bound: true }", async () => {
      const user = await insertUser(db, { username: "alice", password: "pass1234" });
      const { authorize_url } = await sso.start({ mode: "bind", bindUserId: user.id });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const result = await sso.exchange({ code: "auth-code", state }, ctx);
      expect(result).toEqual({ kind: "bound" });
      // 身份已落库：再次 login 模式直接发 token
      const again = await sso.start({ mode: "login" });
      const state2 = new URL(again.authorize_url).searchParams.get("state")!;
      const second = await sso.exchange({ code: "auth-code", state: state2 }, ctx);
      expect(second.kind).toBe("tokens");
    });

    it("bind 模式：该 UC 账号已绑定其他用户 → 409 IDENTITY_BOUND", async () => {
      const alice = await insertUser(db, { username: "alice", password: "pass1234" });
      await insertUcIdentity(db, alice.id, "uc-sub-1");
      const bob = await insertUser(db, { username: "bob", password: "pass1234" });
      const { authorize_url } = await sso.start({ mode: "bind", bindUserId: bob.id });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const err = await sso.exchange({ code: "auth-code", state }, ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("IDENTITY_BOUND");
    });

    it("login 模式：身份对应的本地用户已禁用 → 403 USER_DISABLED", async () => {
      const user = await insertUser(db, { username: "alice", status: "disabled" });
      await insertUcIdentity(db, user.id, "uc-sub-1");
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const err = await sso.exchange({ code: "auth-code", state }, ctx).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("USER_DISABLED");
    });
  });

  describe("sso/link（关联已有账号）", () => {
    async function pendingTokenFor(ucSub = "uc-sub-1", username = "alice_uc") {
      sso = buildService(
        mockUcClient({
          getUserinfo: async () => ({ id: ucSub, username, role: "user", client_id: "doughpie" }),
        }),
      );
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const result = await sso.exchange({ code: "auth-code", state }, ctx);
      if (result.kind !== "pending") throw new Error("预期 pending 分支");
      return result.pending.pending_token;
    }

    it("正确本地账密 → 绑定并发 TokenPair；之后 SSO 直登", async () => {
      const user = await insertUser(db, { username: "alice", password: "pass1234" });
      const pendingToken = await pendingTokenFor();
      const result = await sso.link(
        { pending_token: pendingToken, username: "alice", password: "pass1234" },
        ctx,
      );
      expect(tokenPairSchema.safeParse(result.tokens).success).toBe(true);
      expect(result.user.id).toBe(user.id);
      expect(result.user.has_uc_identity).toBe(true);

      // 绑定后再次 SSO：直接发 token（不再 pending）
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const again = await sso.exchange({ code: "auth-code", state }, ctx);
      expect(again.kind).toBe("tokens");
    });

    it("密码错误 → INVALID_CREDENTIALS，且计入防爆破（再错 9 次即锁定）", async () => {
      await insertUser(db, { username: "alice", password: "pass1234" });
      const pendingToken = await pendingTokenFor();
      const err = await sso
        .link({ pending_token: pendingToken, username: "alice", password: "wrong123" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("INVALID_CREDENTIALS");

      // 关联校验计入防爆破：同一 username+ip 再失败 9 次即触发锁定
      for (let i = 0; i < 9; i++) {
        // oxlint-disable-next-line no-await-in-loop -- 测试必须串行累计失败次数
        await sso
          .link({ pending_token: pendingToken, username: "alice", password: "wrong123" }, ctx)
          .catch(() => undefined);
      }
      const tenth = await sso
        .link({ pending_token: pendingToken, username: "alice", password: "wrong123" }, ctx)
        .catch((e: unknown) => e);
      expect((tenth as ApiError).code).toBe("LOGIN_LOCKED");
    });

    it("pending_token 伪造 → PENDING_SSO_EXPIRED", async () => {
      const err = await sso
        .link({ pending_token: "forged", username: "alice", password: "pass1234" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("PENDING_SSO_EXPIRED");
    });

    it("该 UC 账号已绑定其他用户 → 409 IDENTITY_BOUND", async () => {
      await insertUser(db, { username: "alice", password: "pass1234" });
      const bob = await insertUser(db, { username: "bob", password: "pass1234" });
      // 先拿到 pending 票据，随后该 UC 账号被他人抢先绑定（竞态窗口），再关联应被拒
      const pendingToken = await pendingTokenFor();
      await insertUcIdentity(db, bob.id, "uc-sub-1");
      const err = await sso
        .link({ pending_token: pendingToken, username: "alice", password: "pass1234" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("IDENTITY_BOUND");
    });
  });

  describe("sso/register（创建新账号）", () => {
    async function pendingTokenFor(ucSub = "uc-sub-1", username = "alice_uc") {
      sso = buildService(
        mockUcClient({
          getUserinfo: async () => ({ id: ucSub, username, role: "user", client_id: "doughpie" }),
        }),
      );
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const result = await sso.exchange({ code: "auth-code", state }, ctx);
      if (result.kind !== "pending") throw new Error("预期 pending 分支");
      return result.pending.pending_token;
    }

    it("创建 UC-only 新号（无本地密码）+ 绑定 + 发 TokenPair", async () => {
      const pendingToken = await pendingTokenFor();
      const result = await sso.registerWithUc(
        { pending_token: pendingToken, username: "alice_uc" },
        ctx,
      );
      expect(tokenPairSchema.safeParse(result.tokens).success).toBe(true);
      expect(result.user.username).toBe("alice_uc");
      expect(result.user.has_password).toBe(false);
      expect(result.user.has_uc_identity).toBe(true);
      // 首个注册用户（经 SSO）同样是实例 admin
      expect(result.user.role).toBe("admin");
    });

    it("用户名冲突自动加后缀（alice → alice-2）", async () => {
      await insertUser(db, { username: "alice" });
      const pendingToken = await pendingTokenFor("uc-sub-1", "alice");
      const result = await sso.registerWithUc(
        { pending_token: pendingToken, username: "alice" },
        ctx,
      );
      expect(result.user.username).toBe("alice-2");
    });

    it("pending_token 无效 → PENDING_SSO_EXPIRED", async () => {
      const err = await sso
        .registerWithUc({ pending_token: "forged", username: "alice" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("PENDING_SSO_EXPIRED");
    });
  });

  describe("解绑保护", () => {
    it("有本地密码的混合账号可解绑 UC", async () => {
      const user = await insertUser(db, { username: "alice", password: "pass1234" });
      await insertUcIdentity(db, user.id, "uc-sub-1");
      await sso.unbindUc(user.id);
      // 解绑后 SSO 再走 pending 分支
      const { authorize_url } = await sso.start({ mode: "login" });
      const state = new URL(authorize_url).searchParams.get("state")!;
      const result = await sso.exchange({ code: "auth-code", state }, ctx);
      expect(result.kind).toBe("pending");
    });

    it("无本地密码且仅剩 UC 身份 → 409 UNBIND_FORBIDDEN", async () => {
      const user = await insertUser(db, { username: "alice" }); // UC-only
      await insertUcIdentity(db, user.id, "uc-sub-1");
      const err = await sso.unbindUc(user.id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(409);
      expect((err as ApiError).code).toBe("UNBIND_FORBIDDEN");
    });

    it("未绑定 UC → 404 NOT_FOUND", async () => {
      const user = await insertUser(db, { username: "alice", password: "pass1234" });
      const err = await sso.unbindUc(user.id).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("NOT_FOUND");
    });
  });
});
