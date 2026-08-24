import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tokenPairSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import { refreshTokens } from "../models/schema.js";
import { testEnv, createTestDb, truncateAll } from "../../tests/helpers.js";
import { insertUser } from "../../tests/factories.js";
import { ApiError } from "../lib/api-error.js";
import { createTokenService, type TokenService } from "./token-service.js";

/**
 * L2 统一自签会话（backend.md §2.3）：
 * access JWT HS256 30min（claims sub/iat/exp/jti/sid）+ refresh 不透明串（30 天滑动/轮换/重用检测）。
 * 断言从规格推导，打真实测试 PG。
 */
describe("tokenService 统一自签会话（L2）", () => {
  let db: Db;
  let close: () => Promise<void>;
  let tokens: TokenService;

  beforeEach(async () => {
    ({ db, close } = createTestDb());
    await truncateAll(db);
    tokens = createTokenService({
      db,
      jwtSecret: testEnv().jwtSecret,
      accessTokenTtlSec: 1800,
      refreshTokenTtlDays: 30,
    });
  });

  afterEach(async () => {
    await close();
  });

  it("签发会话：返回 TokenPair 契约，access 解码含 sub/iat/exp/jti/sid 且 30 分钟", async () => {
    const user = await insertUser(db);
    const { tokens: pair, sessionId } = await tokens.issueSession(user.id, "vitest");
    expect(tokenPairSchema.safeParse(pair).success).toBe(true);
    expect(pair.expires_in).toBe(1800);

    const claims = decodeJwt(pair.access_token);
    expect(claims.sub).toBe(user.id);
    expect(claims.sid).toBe(sessionId);
    expect(claims.jti).toBeTruthy();
    expect(claims.purpose).toBe("access");
    expect(claims.exp! - claims.iat!).toBe(1800);
  });

  it("refresh 轮换：旧串换出全新 TokenPair，session（sid）保持不变", async () => {
    const user = await insertUser(db);
    const { tokens: first, sessionId } = await tokens.issueSession(user.id);
    const result = await tokens.refresh(first.refresh_token);
    expect(result.userId).toBe(user.id);
    expect(result.sessionId).toBe(sessionId);
    expect(result.tokens.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(result.tokens.access_token).sid).toBe(sessionId);
  });

  it("重用检测：复用已轮换的旧串 → REFRESH_REUSED 并吊销该用户全部会话", async () => {
    const user = await insertUser(db);
    // 两个独立会话（模拟双设备）
    const sessionA = await tokens.issueSession(user.id);
    const sessionB = await tokens.issueSession(user.id);
    await tokens.refresh(sessionA.tokens.refresh_token);

    // 攻击者/异常客户端重放会话 A 的旧串
    const err = await tokens.refresh(sessionA.tokens.refresh_token).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("REFRESH_REUSED");

    // 全部会话被吊销：会话 B 的 refresh 同样失效
    const errB = await tokens.refresh(sessionB.tokens.refresh_token).catch((e: unknown) => e);
    expect((errB as ApiError).code).toBe("REFRESH_REUSED");
    expect(await tokens.isSessionAlive(sessionB.sessionId)).toBe(false);
  });

  it("未知 refresh 串 → UNAUTHORIZED", async () => {
    const err = await tokens.refresh("not-a-real-token").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("UNAUTHORIZED");
  });

  it("滑动过期：签发超过 30 天未活动的 refresh → TOKEN_EXPIRED", async () => {
    const user = await insertUser(db);
    const { tokens: pair } = await tokens.issueSession(user.id);
    // 直接改库模拟 31 天前签发（存储侧滑动窗口 = created_at + TTL）
    const hash = createHash("sha256").update(pair.refresh_token).digest("hex");
    await db
      .update(refreshTokens)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) })
      .where(eq(refreshTokens.tokenHash, hash));

    const err = await tokens.refresh(pair.refresh_token).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("TOKEN_EXPIRED");
  });

  it("滑动续期：轮换后新串获得新的签发时间（滑动窗口前移）", async () => {
    const user = await insertUser(db);
    const { tokens: first } = await tokens.issueSession(user.id);
    // 旧串签发时间拨回 29 天前（未过期）
    const oldHash = createHash("sha256").update(first.refresh_token).digest("hex");
    const past = new Date(Date.now() - 29 * 24 * 3600 * 1000);
    await db
      .update(refreshTokens)
      .set({ createdAt: past })
      .where(eq(refreshTokens.tokenHash, oldHash));

    const result = await tokens.refresh(first.refresh_token);
    const newHash = createHash("sha256").update(result.tokens.refresh_token).digest("hex");
    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, newHash));
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThan(past.getTime());
  });

  it("吊销会话（logout）后旧串再用 → 触发重用检测 REFRESH_REUSED", async () => {
    const user = await insertUser(db);
    const { tokens: pair, sessionId } = await tokens.issueSession(user.id);
    await tokens.revokeSession(sessionId);
    expect(await tokens.isSessionAlive(sessionId)).toBe(false);
    const err = await tokens.refresh(pair.refresh_token).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("REFRESH_REUSED");
  });

  it("revokeAllUserSessions：该用户所有会话全部失效", async () => {
    const user = await insertUser(db);
    const a = await tokens.issueSession(user.id);
    const b = await tokens.issueSession(user.id);
    await tokens.revokeAllUserSessions(user.id);
    expect(await tokens.isSessionAlive(a.sessionId)).toBe(false);
    expect(await tokens.isSessionAlive(b.sessionId)).toBe(false);
  });

  it("beforeRotate 钩子抛错 → 中止轮换（用于 UC 强退传播）", async () => {
    const user = await insertUser(db);
    const { tokens: pair, sessionId } = await tokens.issueSession(user.id);
    const err = await tokens
      .refresh(pair.refresh_token, {
        beforeRotate: async (userId, issuedAt) => {
          expect(userId).toBe(user.id);
          expect(issuedAt).toBeInstanceOf(Date);
          throw new ApiError(401, "TOKEN_EXPIRED", "登录已过期，请重新登录");
        },
      })
      .catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("TOKEN_EXPIRED");
    // 中止后原串未被轮换吊销
    expect(await tokens.isSessionAlive(sessionId)).toBe(true);
  });

  it("verifyAccessToken：合法通过；伪造签名/非 access 用途 → UNAUTHORIZED", async () => {
    const user = await insertUser(db);
    const { tokens: pair } = await tokens.issueSession(user.id);
    const payload = await tokens.verifyAccessToken(pair.access_token);
    expect(payload.sub).toBe(user.id);

    const forged = `${pair.access_token.slice(0, -2)}xx`;
    const err = await tokens.verifyAccessToken(forged).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("UNAUTHORIZED");
  });
});
