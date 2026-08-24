import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { count, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  COPY,
  type ChangePasswordBody,
  type LoginBody,
  type RegisterBody,
  type TokenPair,
  type UpdateMeBody,
  type User,
} from "@doughpie/shared";
import type { Db } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { sha256Hex } from "../lib/token-hash.js";
import { refreshTokens, userIdentities, users, type UserRow } from "../models/schema.js";
import { loginGuardKey, type LoginGuard } from "./login-guard.js";
import type { TokenService } from "./token-service.js";
import { toUserDto } from "./user-dto.js";

/**
 * 本地账号体系业务流（backend.md §2.2/§2.3/§2.4）。
 * 身份归身份、登录归登录：users 自含密码凭证，UC 仅经 user_identities 关联。
 */

export interface ForceLogoutCacheLike {
  get(): Date | null;
}

export interface AuthServiceDeps {
  db: Db;
  tokenService: TokenService;
  loginGuard: LoginGuard;
  /** 锁定时长（分钟），仅用于 LOGIN_LOCKED 文案 */
  loginLockMinutes: number;
  /** UC 强退传播（§2.5）：仅 UC_ENABLED 时注入；按本地 userId 返回强退水位线 */
  uc?: { getForceLogoutBefore: (userId: string) => Date | null };
}

export interface RequestCtx {
  ip?: string;
  deviceInfo?: string;
}

export type AuthService = ReturnType<typeof createAuthService>;

/** 惰性生成一次性 dummy hash：用户不存在时也走一次 verify，抹平计时侧信道 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= argon2Hash("doughpie-timing-equalizer");
  return dummyHashPromise;
}

export function createAuthService(deps: AuthServiceDeps) {
  const { db, tokenService, loginGuard, loginLockMinutes } = deps;

  async function hasUcIdentity(userId: string): Promise<boolean> {
    const row = await db.query.userIdentities.findFirst({
      where: eq(userIdentities.userId, userId),
      columns: { id: true },
    });
    return row !== undefined;
  }

  async function loadUserOr404(userId: string): Promise<UserRow> {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    return user;
  }

  async function toDto(user: UserRow): Promise<User> {
    return toUserDto(user, await hasUcIdentity(user.id));
  }

  /** 登录失败统一出口：计入防爆破，达阈值切换为锁定错误 */
  function failLogin(key: string): never {
    const { locked } = loginGuard.recordFailure(key);
    if (locked) {
      throw new ApiError(429, "LOGIN_LOCKED", COPY.auth.loginLocked(loginLockMinutes));
    }
    throw new ApiError(401, "INVALID_CREDENTIALS", COPY.auth.loginFailed);
  }

  return {
    /** 注册（真实本地注册；首注册用户自动为实例 admin，P0-16/§2.8） */
    async register(
      body: RegisterBody,
      ctx: RequestCtx,
    ): Promise<{ tokens: TokenPair; user: User }> {
      const countRows = await db.select({ value: count() }).from(users);
      const role = (countRows[0]?.value ?? 0) === 0 ? "admin" : "user";
      let user: UserRow;
      try {
        const [inserted] = await db
          .insert(users)
          .values({
            id: uuidv7(),
            username: body.username,
            passwordHash: await argon2Hash(body.password),
            displayName: body.display_name ?? body.username,
            role,
          })
          .returning();
        if (!inserted) throw new Error("注册插入失败");
        user = inserted;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ApiError(409, "USERNAME_TAKEN", COPY.auth.usernameTaken);
        }
        throw err;
      }
      const { tokens } = await tokenService.issueSession(user.id, ctx.deviceInfo);
      return { tokens, user: await toDto(user) };
    },

    /** 本地密码登录（限流/锁定，username+ip 维度） */
    async login(body: LoginBody, ctx: RequestCtx): Promise<{ tokens: TokenPair; user: User }> {
      const key = loginGuardKey(body.username, ctx.ip ?? "unknown");
      if (loginGuard.isLocked(key)) {
        throw new ApiError(429, "LOGIN_LOCKED", COPY.auth.loginLocked(loginLockMinutes));
      }
      const user = await db.query.users.findFirst({
        where: eq(users.username, body.username),
      });
      if (!user || !user.passwordHash) {
        // 用户不存在 / UC-only 无本地密码：同样走一次 verify 抹平计时，报错与密码错误一致
        await argon2Verify(await dummyHash(), body.password).catch(() => false);
        failLogin(key);
      }
      const ok = await argon2Verify(user.passwordHash, body.password).catch(() => false);
      if (!ok) failLogin(key);
      loginGuard.recordSuccess(key);
      if (user.status === "disabled") {
        throw new ApiError(403, "USER_DISABLED", COPY.auth.userDisabled);
      }
      const { tokens } = await tokenService.issueSession(user.id, ctx.deviceInfo);
      return { tokens, user: await toDto(user) };
    },

    /** 静默刷新（单飞由客户端保证）；UC 强退传播在轮换前钩子中裁决 */
    async refresh(refreshToken: string): Promise<TokenPair> {
      const result = await tokenService.refresh(refreshToken, {
        beforeRotate: async (userId, issuedAt) => {
          const forceLogoutBefore = deps.uc?.getForceLogoutBefore(userId) ?? null;
          if (!forceLogoutBefore) return;
          if (issuedAt < forceLogoutBefore) {
            // UC 侧已强制下线：吊销本地全部会话，要求重新登录
            await tokenService.revokeAllUserSessions(userId);
            throw new ApiError(401, "TOKEN_EXPIRED", COPY.auth.tokenExpired);
          }
        },
      });
      return result.tokens;
    },

    /** 退出当前会话（幂等：串不存在也视为成功） */
    async logout(refreshToken: string): Promise<void> {
      const row = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, sha256Hex(refreshToken)),
        columns: { sessionId: true },
      });
      if (row) await tokenService.revokeSession(row.sessionId);
    },

    /** 全端下线 */
    async logoutAll(userId: string): Promise<void> {
      await tokenService.revokeAllUserSessions(userId);
    },

    async getMe(userId: string): Promise<User> {
      return toDto(await loadUserOr404(userId));
    },

    async updateMe(userId: string, body: UpdateMeBody): Promise<User> {
      const [updated] = await db
        .update(users)
        .set({ displayName: body.display_name, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (!updated) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      return toDto(updated);
    },

    /**
     * 改密 → 全端下线（吊销全部会话）；
     * UC-only 账号（password_hash 为空）免验 old_password，补设后变混合账号。
     */
    async changePassword(userId: string, body: ChangePasswordBody): Promise<void> {
      const user = await loadUserOr404(userId);
      if (user.passwordHash !== null) {
        if (!body.old_password) {
          throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
        }
        const ok = await argon2Verify(user.passwordHash, body.old_password).catch(() => false);
        if (!ok) throw new ApiError(401, "INVALID_CREDENTIALS", COPY.auth.loginFailed);
      }
      await db
        .update(users)
        .set({ passwordHash: await argon2Hash(body.new_password), updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tokenService.revokeAllUserSessions(userId);
    },

    hasUcIdentity,
  };
}
