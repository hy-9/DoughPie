import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db.js";
import { createTestDb, testEnv, truncateAll } from "../../tests/helpers.js";
import { insertUcIdentity, insertUser } from "../../tests/factories.js";
import { ApiError } from "../lib/api-error.js";
import { createAuthService, type AuthService } from "../services/auth-service.js";
import { LoginGuard } from "../services/login-guard.js";
import { createTokenService, type TokenService } from "../services/token-service.js";
import { createForceLogoutCache, startForceLogoutPoller } from "./force-logout.js";
import type { UcClient } from "./uc-client.js";

/**
 * UC 强退传播（backend.md §2.5）：60s 内存缓存轮询 UC force-logout-ts（按用户维度，以 UC 代码为准），
 * 本地 refresh 签发时间早于水位线 → 吊销全部会话。UC 客户端 mock，禁真实网络。
 */
describe("UC 强退传播（L2）", () => {
  let db: Db;
  let close: () => Promise<void>;
  let tokens: TokenService;
  const cache = createForceLogoutCache();
  const logs: unknown[] = [];
  const log = { warn: (obj: unknown) => logs.push(obj) };

  function buildAuth(): AuthService {
    return createAuthService({
      db,
      tokenService: tokens,
      loginGuard: new LoginGuard({ maxFailures: 10, lockMinutes: 15 }),
      loginLockMinutes: 15,
      uc: { getForceLogoutBefore: (userId) => cache.get(userId) },
    });
  }

  beforeEach(async () => {
    ({ db, close } = createTestDb());
    await truncateAll(db);
    tokens = createTokenService({
      db,
      jwtSecret: testEnv().jwtSecret,
      accessTokenTtlSec: 1800,
      refreshTokenTtlDays: 30,
    });
    logs.length = 0;
  });

  afterEach(async () => {
    await close();
  });

  it("refresh 签发时间早于 UC 强退水位线 → TOKEN_EXPIRED 且吊销全部会话", async () => {
    const user = await insertUser(db, { username: "alice" });
    await insertUcIdentity(db, user.id, "uc-sub-1");
    const session = await tokens.issueSession(user.id);

    // UC 水位线在未来 = 该用户所有现存会话都是被强退前签发的
    const mockUc: UcClient = {
      exchangeCode: async () => ({ accessToken: "" }),
      getUserinfo: async () => ({ id: "uc-sub-1", username: "alice", role: "user" }),
      getForceLogoutBefore: async () => new Date(Date.now() + 60_000),
    };
    const poller = startForceLogoutPoller({
      db,
      ucClient: mockUc,
      cache,
      log,
      intervalMs: 3_600_000,
    });
    await poller.tick();
    poller.stop();

    const err = await buildAuth()
      .refresh(session.tokens.refresh_token)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("TOKEN_EXPIRED");
    expect(await tokens.isSessionAlive(session.sessionId)).toBe(false);
  });

  it("水位线之后的会话正常刷新；未绑定 UC 的用户不受影响", async () => {
    const ucUser = await insertUser(db, { username: "alice" });
    await insertUcIdentity(db, ucUser.id, "uc-sub-1");
    const localUser = await insertUser(db, { username: "bob", password: "pass1234" });
    const ucSession = await tokens.issueSession(ucUser.id);
    const localSession = await tokens.issueSession(localUser.id);

    // 水位线在过去 = 现存会话都是强退之后签发的
    const mockUc: UcClient = {
      exchangeCode: async () => ({ accessToken: "" }),
      getUserinfo: async () => ({ id: "uc-sub-1", username: "alice", role: "user" }),
      getForceLogoutBefore: async () => new Date(Date.now() - 3_600_000),
    };
    const poller = startForceLogoutPoller({
      db,
      ucClient: mockUc,
      cache,
      log,
      intervalMs: 3_600_000,
    });
    await poller.tick();
    poller.stop();

    const auth = buildAuth();
    const refreshedUc = await auth.refresh(ucSession.tokens.refresh_token);
    expect(refreshedUc.refresh_token).toBeTruthy();
    const refreshedLocal = await auth.refresh(localSession.tokens.refresh_token);
    expect(refreshedLocal.refresh_token).toBeTruthy();
  });

  it("UC 查询失败 → 保留旧缓存不放大故障，并告警日志", async () => {
    const user = await insertUser(db, { username: "alice" });
    await insertUcIdentity(db, user.id, "uc-sub-1");
    const oldValue = new Date(Date.now() - 1000);
    cache.replaceAll(new Map([[user.id, oldValue]]));

    const failingUc: UcClient = {
      exchangeCode: async () => ({ accessToken: "" }),
      getUserinfo: async () => ({ id: "uc-sub-1", username: "alice", role: "user" }),
      getForceLogoutBefore: async () => {
        throw new ApiError(502, "INTERNAL", "统一认证服务暂时不可用，请稍后再试");
      },
    };
    const poller = startForceLogoutPoller({
      db,
      ucClient: failingUc,
      cache,
      log,
      intervalMs: 3_600_000,
    });
    await poller.tick();
    poller.stop();

    expect(cache.get(user.id)).toEqual(oldValue);
    expect(logs.length).toBeGreaterThan(0);
  });
});
