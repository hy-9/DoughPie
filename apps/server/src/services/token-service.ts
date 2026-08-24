import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { errors as joseErrors, SignJWT, jwtVerify } from "jose";
import { v7 as uuidv7 } from "uuid";
import { COPY, type TokenPair } from "@doughpie/shared";
import type { Db } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { sha256Hex } from "../lib/token-hash.js";
import { refreshTokens } from "../models/schema.js";

/**
 * 统一自签会话（backend.md §2.3）：
 * - access：JWT HS256，claims sub/iat/exp/jti/sid + purpose=access（与 pending_sso 票据区分）；
 * - refresh：不透明随机串，DB 只存 SHA-256 哈希；每次刷新轮换（旧行 revoked 保留用于重用检测），
 *   滑动过期 = 当前活跃行 created_at + TTL；复用已吊销串 → 吊销该用户全部会话。
 */

export interface TokenServiceDeps {
  db: Db;
  jwtSecret: string;
  /** access token 寿命（秒） */
  accessTokenTtlSec: number;
  /** refresh token 滑动寿命（天） */
  refreshTokenTtlDays: number;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
  purpose: "access";
}

export interface RefreshHooks {
  /** 轮换前钩子（UC 强退传播等）：抛错即中止轮换，原串不吊销 */
  beforeRotate?: (userId: string, issuedAt: Date) => Promise<void>;
}

export type TokenService = ReturnType<typeof createTokenService>;

/** 生成不透明 refresh 串；明文只出现在响应里，DB 只落 SHA-256 哈希 */
function newRefreshToken(): { plain: string; hash: string } {
  const plain = randomBytes(48).toString("base64url");
  return { plain, hash: sha256Hex(plain) };
}

export function createTokenService(deps: TokenServiceDeps) {
  const { db, accessTokenTtlSec, refreshTokenTtlDays } = deps;
  const jwtKey = new TextEncoder().encode(deps.jwtSecret);
  const refreshTtlMs = refreshTokenTtlDays * 24 * 3600 * 1000;

  async function signAccessToken(userId: string, sessionId: string): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ sid: sessionId, jti: uuidv7(), purpose: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt(iat)
      .setExpirationTime(iat + accessTokenTtlSec)
      .sign(jwtKey);
  }

  function toTokenPair(accessToken: string, refreshPlain: string): TokenPair {
    return {
      access_token: accessToken,
      expires_in: accessTokenTtlSec,
      refresh_token: refreshPlain,
    };
  }

  return {
    /** 登录/注册成功后签发新会话（一次登录 = 一条 session） */
    async issueSession(
      userId: string,
      deviceInfo?: string,
    ): Promise<{ tokens: TokenPair; sessionId: string }> {
      const sessionId = uuidv7();
      const refresh = newRefreshToken();
      await db.insert(refreshTokens).values({
        id: uuidv7(),
        userId,
        sessionId,
        tokenHash: refresh.hash,
        deviceInfo: deviceInfo ?? null,
      });
      const accessToken = await signAccessToken(userId, sessionId);
      return { tokens: toTokenPair(accessToken, refresh.plain), sessionId };
    },

    /** 静默刷新：校验 + 轮换；钩子可在轮换前否决（如 UC 强退传播） */
    async refresh(
      token: string,
      hooks?: RefreshHooks,
    ): Promise<{ tokens: TokenPair; userId: string; sessionId: string }> {
      const hash = sha256Hex(token);
      const row = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, hash),
      });
      if (!row) {
        throw new ApiError(401, "UNAUTHORIZED", COPY.common.unauthorized);
      }
      if (row.revokedAt) {
        // 重用检测：已轮换/吊销的串再次出现 = 可能泄露，吊销该用户全部会话
        await this.revokeAllUserSessions(row.userId);
        throw new ApiError(401, "REFRESH_REUSED", COPY.auth.refreshReused);
      }
      if (Date.now() > row.createdAt.getTime() + refreshTtlMs) {
        throw new ApiError(401, "TOKEN_EXPIRED", COPY.auth.tokenExpired);
      }
      await hooks?.beforeRotate?.(row.userId, row.createdAt);

      const next = newRefreshToken();
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now, lastSeenAt: now })
          .where(eq(refreshTokens.id, row.id));
        await tx.insert(refreshTokens).values({
          id: uuidv7(),
          userId: row.userId,
          sessionId: row.sessionId,
          tokenHash: next.hash,
          deviceInfo: row.deviceInfo,
        });
      });
      const accessToken = await signAccessToken(row.userId, row.sessionId);
      return {
        tokens: toTokenPair(accessToken, next.plain),
        userId: row.userId,
        sessionId: row.sessionId,
      };
    },

    /** 会话是否仍有效（authenticate 中间件据此让被吊销会话的 access 立即失效） */
    async isSessionAlive(sessionId: string): Promise<boolean> {
      const row = await db.query.refreshTokens.findFirst({
        where: and(eq(refreshTokens.sessionId, sessionId), isNull(refreshTokens.revokedAt)),
        columns: { id: true },
      });
      return row !== undefined;
    },

    async revokeSession(sessionId: string): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.sessionId, sessionId), isNull(refreshTokens.revokedAt)));
    },

    async revokeAllUserSessions(userId: string): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    },

    /** 校验 access JWT；过期与伪造细分错误码，purpose 不是 access 的一律拒绝 */
    async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
      try {
        const { payload } = await jwtVerify(token, jwtKey);
        if (
          payload.purpose !== "access" ||
          typeof payload.sub !== "string" ||
          typeof payload.sid !== "string" ||
          typeof payload.jti !== "string"
        ) {
          throw new ApiError(401, "UNAUTHORIZED", COPY.common.unauthorized);
        }
        return {
          sub: payload.sub,
          sid: payload.sid,
          jti: payload.jti,
          iat: payload.iat ?? 0,
          exp: payload.exp ?? 0,
          purpose: "access",
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if (err instanceof joseErrors.JWTExpired) {
          throw new ApiError(401, "TOKEN_EXPIRED", COPY.auth.tokenExpired);
        }
        throw new ApiError(401, "UNAUTHORIZED", COPY.common.unauthorized);
      }
    },
  };
}
