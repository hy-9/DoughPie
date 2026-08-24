import { createHash, randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { v7 as uuidv7 } from "uuid";
import {
  COPY,
  PENDING_SSO_TTL_MINUTES,
  USERNAME_MAX,
  type SsoLinkBody,
  type SsoPending,
  type SsoRegisterBody,
  type TokenPair,
  type User,
} from "@doughpie/shared";
import type { Db } from "../db.js";
import type { UcConfig } from "../env.js";
import { ApiError } from "../lib/api-error.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { userIdentities, users, type UserIdentityRow, type UserRow } from "../models/schema.js";
import type { UcClient } from "../uc/uc-client.js";
import type { AuthService, RequestCtx } from "./auth-service.js";
import { toUserDto } from "./user-dto.js";

/**
 * UC SSO 业务流（backend.md §2.4：先问后建；§2.9 契约要点）。
 * state 服务端内存暂存（10 分钟 TTL，一次性）；pending_sso 票据 5 分钟一次性（jti 用后即焚）。
 */

export type SsoMode = "login" | "bind";

export interface SsoStateEntry {
  codeVerifier: string;
  mode: SsoMode;
  /** mode=bind 时绑定到该本地用户 */
  bindUserId: string | null;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

/** state 内存暂存（单进程假设，backend.md §8）；take 一次性读取 */
export function createSsoStateStore(now: () => number = Date.now) {
  const entries = new Map<string, SsoStateEntry>();
  const usedPendingJtis = new Map<string, number>();
  return {
    /** 过期时间由 store 用自己的时钟计算，保证与 take 判定同源（测试可注入时钟） */
    put(state: string, entry: Omit<SsoStateEntry, "expiresAt">): void {
      entries.set(state, { ...entry, expiresAt: now() + STATE_TTL_MS });
    },
    /** 一次性：取出即删；过期等同不存在 */
    take(state: string): SsoStateEntry | null {
      const entry = entries.get(state) ?? null;
      entries.delete(state);
      if (!entry || entry.expiresAt <= now()) return null;
      return entry;
    },
    /** pending 票据用后即焚（5 分钟窗口内防重放） */
    isPendingJtiUsed(jti: string): boolean {
      return usedPendingJtis.has(jti);
    },
    markPendingJtiUsed(jti: string): void {
      usedPendingJtis.set(jti, now());
      // 惰性清理过期 jti，防内存膨胀
      for (const [key, at] of usedPendingJtis) {
        if (now() - at > PENDING_SSO_TTL_MINUTES * 60 * 1000) usedPendingJtis.delete(key);
      }
    },
  };
}
export type SsoStateStore = ReturnType<typeof createSsoStateStore>;

export type SsoExchangeResult =
  | { kind: "tokens"; tokens: TokenPair; user: User }
  | { kind: "pending"; pending: SsoPending }
  | { kind: "bound" };

export interface SsoServiceDeps {
  db: Db;
  tokenService: {
    issueSession: (userId: string, deviceInfo?: string) => Promise<{ tokens: TokenPair }>;
  };
  authService: AuthService;
  jwtSecret: string;
  uc: UcConfig;
  ucClient: UcClient;
  stateStore?: SsoStateStore;
}

export type SsoService = ReturnType<typeof createSsoService>;

/** PKCE S256 挑战码（RFC 7636） */
function base64urlSha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function createSsoService(deps: SsoServiceDeps) {
  const { db, tokenService, authService, uc, ucClient } = deps;
  const stateStore = deps.stateStore ?? createSsoStateStore();
  const jwtKey = new TextEncoder().encode(deps.jwtSecret);

  async function findIdentity(ucSub: string): Promise<UserIdentityRow | undefined> {
    return db.query.userIdentities.findFirst({
      where: and(eq(userIdentities.provider, "uc"), eq(userIdentities.providerUserId, ucSub)),
    });
  }

  /** 绑定 UC 身份到本地用户；已被他人绑定 → 409 IDENTITY_BOUND */
  async function bindIdentity(userId: string, ucSub: string): Promise<void> {
    const existing = await findIdentity(ucSub);
    if (existing) {
      if (existing.userId !== userId) {
        // COPY 无对应文案（契约缺口已记录），行内中文
        throw new ApiError(409, "IDENTITY_BOUND", "该统一认证账号已绑定其他用户");
      }
      return; // 幂等：重复绑定同一用户直接成功
    }
    try {
      await db
        .insert(userIdentities)
        .values({ id: uuidv7(), userId, provider: "uc", providerUserId: ucSub });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiError(409, "IDENTITY_BOUND", "该统一认证账号已绑定其他用户");
      }
      throw err;
    }
  }

  /** 签发 5 分钟一次性 pending_sso 票据（含 uc_sub + 预填用户名） */
  async function signPendingToken(ucSub: string, suggestedUsername: string): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({
      purpose: "pending_sso",
      uc_sub: ucSub,
      suggested_username: suggestedUsername,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(uuidv7())
      .setIssuedAt(iat)
      .setExpirationTime(iat + PENDING_SSO_TTL_MINUTES * 60)
      .sign(jwtKey);
  }

  async function verifyPendingToken(
    token: string,
  ): Promise<{ ucSub: string; suggestedUsername: string; jti: string }> {
    try {
      const { payload } = await jwtVerify(token, jwtKey);
      if (
        payload.purpose !== "pending_sso" ||
        typeof payload.uc_sub !== "string" ||
        typeof payload.suggested_username !== "string" ||
        typeof payload.jti !== "string" ||
        stateStore.isPendingJtiUsed(payload.jti)
      ) {
        throw new Error("invalid pending token");
      }
      return {
        ucSub: payload.uc_sub,
        suggestedUsername: payload.suggested_username,
        jti: payload.jti,
      };
    } catch {
      throw new ApiError(401, "PENDING_SSO_EXPIRED", COPY.auth.pendingSsoExpired);
    }
  }

  /** 冲突自动加后缀（alice → alice-2），超长时截断基底保 USERNAME_MAX */
  async function insertWithUniqueUsername(
    base: string,
    role: "admin" | "user",
    displayName?: string,
  ): Promise<UserRow> {
    for (let i = 0; i < 50; i++) {
      const candidate =
        i === 0 ? base : `${base.slice(0, USERNAME_MAX - String(i + 1).length - 1)}-${i + 1}`;
      try {
        // oxlint-disable-next-line no-await-in-loop -- 串行重试是有意设计：逐个探测唯一用户名，并行会产生重复冲突
        const [row] = await db
          .insert(users)
          .values({
            id: uuidv7(),
            username: candidate,
            passwordHash: null, // UC-only 账号
            displayName: displayName ?? candidate,
            role,
          })
          .returning();
        if (row) return row;
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new ApiError(500, "INTERNAL", COPY.common.internal);
  }

  return {
    /** SSO 起跳：生成 state + PKCE，返回 UC 授权页地址（参数形状以 UC authorize 处理器为准） */
    async start(input: { mode: SsoMode; bindUserId?: string }): Promise<{ authorize_url: string }> {
      const state = randomBytes(24).toString("base64url");
      const codeVerifier = randomBytes(32).toString("base64url");
      stateStore.put(state, {
        codeVerifier,
        mode: input.mode,
        bindUserId: input.bindUserId ?? null,
      });
      const url = new URL(`${uc.baseUrl}/oauth/authorize`);
      url.searchParams.set("client_id", uc.clientId);
      url.searchParams.set("redirect_uri", uc.redirectUri);
      url.searchParams.set("code_challenge", base64urlSha256(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      return { authorize_url: url.toString() };
    },

    /** 回调换票：bind → 绑定当前用户；login 已绑定 → 发 token；未绑定 → pending 票据 */
    async exchange(
      input: { code: string; state: string },
      ctx: RequestCtx,
    ): Promise<SsoExchangeResult> {
      const entry = stateStore.take(input.state);
      if (!entry) throw new ApiError(401, "PENDING_SSO_EXPIRED", COPY.auth.pendingSsoExpired);
      const { accessToken } = await ucClient.exchangeCode({
        code: input.code,
        codeVerifier: entry.codeVerifier,
      });
      const info = await ucClient.getUserinfo(accessToken);

      if (entry.mode === "bind") {
        if (!entry.bindUserId) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        await bindIdentity(entry.bindUserId, info.id);
        return { kind: "bound" };
      }

      const identity = await findIdentity(info.id);
      if (!identity) {
        const pendingToken = await signPendingToken(info.id, info.username);
        return {
          kind: "pending",
          pending: {
            pending_token: pendingToken,
            suggested_username: info.username,
            expires_in: PENDING_SSO_TTL_MINUTES * 60,
          },
        };
      }
      const user = await db.query.users.findFirst({ where: eq(users.id, identity.userId) });
      if (!user) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      if (user.status === "disabled")
        throw new ApiError(403, "USER_DISABLED", COPY.auth.userDisabled);
      const { tokens } = await tokenService.issueSession(user.id, ctx.deviceInfo);
      return { kind: "tokens", tokens, user: toUserDto(user, true) };
    },

    /** 首登选择 a：关联已有账号——验本地账密（计入防爆破）→ 绑定 → 发 token */
    async link(body: SsoLinkBody, ctx: RequestCtx): Promise<{ tokens: TokenPair; user: User }> {
      const pending = await verifyPendingToken(body.pending_token);
      // 复用本地登录校验：防爆破/禁用判定/发会话一条路径
      const { tokens, user } = await authService.login(
        { username: body.username, password: body.password },
        ctx,
      );
      await bindIdentity(user.id, pending.ucSub);
      stateStore.markPendingJtiUsed(pending.jti);
      return { tokens, user: await authService.getMe(user.id) };
    },

    /** 首登选择 b：创建新号（预填用户名可改，冲突加后缀）→ 绑定 → 发 token */
    async registerWithUc(
      body: SsoRegisterBody,
      ctx: RequestCtx,
    ): Promise<{ tokens: TokenPair; user: User }> {
      const pending = await verifyPendingToken(body.pending_token);
      if (await findIdentity(pending.ucSub)) {
        throw new ApiError(409, "IDENTITY_BOUND", "该统一认证账号已绑定其他用户");
      }
      // 与本地注册一致：首个用户自动实例 admin
      const countRows = await db.select({ value: count() }).from(users);
      const user = await insertWithUniqueUsername(
        body.username,
        (countRows[0]?.value ?? 0) === 0 ? "admin" : "user",
        body.display_name,
      );
      await bindIdentity(user.id, pending.ucSub);
      stateStore.markPendingJtiUsed(pending.jti);
      const { tokens } = await tokenService.issueSession(user.id, ctx.deviceInfo);
      return { tokens, user: toUserDto(user, true) };
    },

    /** 解绑保护：无本地密码且仅剩该身份 → 409 UNBIND_FORBIDDEN */
    async unbindUc(userId: string): Promise<void> {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      const identity = await db.query.userIdentities.findFirst({
        where: and(eq(userIdentities.userId, userId), eq(userIdentities.provider, "uc")),
      });
      if (!identity) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      if (user.passwordHash === null) {
        throw new ApiError(409, "UNBIND_FORBIDDEN", COPY.auth.unbindForbidden);
      }
      await db.delete(userIdentities).where(eq(userIdentities.id, identity.id));
    },
  };
}
