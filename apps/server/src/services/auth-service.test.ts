import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { tokenPairSchema, userSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import { users } from "../models/schema.js";
import { createTestDb, testEnv, truncateAll } from "../../tests/helpers.js";
import { insertUcIdentity, insertUser } from "../../tests/factories.js";
import { ApiError } from "../lib/api-error.js";
import { createAuthService, type AuthService } from "./auth-service.js";
import { LoginGuard } from "./login-guard.js";
import { createTokenService, type TokenService } from "./token-service.js";

/**
 * L2 本地账号体系业务流（backend.md §2.2/§2.3/§2.4）。
 * 断言从规格推导：首注册用户为实例 admin、防爆破 10 锁 15、改密全端下线、UC-only 可补设密码。
 */
describe("authService 本地账号体系（L2）", () => {
  let db: Db;
  let close: () => Promise<void>;
  let auth: AuthService;
  let tokens: TokenService;
  const ctx = { ip: "10.0.0.1", deviceInfo: "vitest" };

  beforeEach(async () => {
    ({ db, close } = createTestDb());
    await truncateAll(db);
    tokens = createTokenService({
      db,
      jwtSecret: testEnv().jwtSecret,
      accessTokenTtlSec: 1800,
      refreshTokenTtlDays: 30,
    });
    auth = createAuthService({
      db,
      tokenService: tokens,
      loginGuard: new LoginGuard({ maxFailures: 10, lockMinutes: 15 }),
      loginLockMinutes: 15,
    });
  });

  afterEach(async () => {
    await close();
  });

  describe("注册", () => {
    it("首个注册用户自动成为实例 admin，返回 TokenPair 与 User 契约", async () => {
      const result = await auth.register(
        { username: "alice", password: "pass1234", display_name: "爱丽丝" },
        ctx,
      );
      expect(tokenPairSchema.safeParse(result.tokens).success).toBe(true);
      expect(userSchema.safeParse(result.user).success).toBe(true);
      expect(result.user.role).toBe("admin");
      expect(result.user.display_name).toBe("爱丽丝");
      expect(result.user.has_password).toBe(true);
      expect(result.user.has_uc_identity).toBe(false);
    });

    it("第二个注册用户为普通 user", async () => {
      await auth.register({ username: "alice", password: "pass1234" }, ctx);
      const second = await auth.register({ username: "bob", password: "pass1234" }, ctx);
      expect(second.user.role).toBe("user");
    });

    it("display_name 缺省时回退为用户名", async () => {
      const result = await auth.register({ username: "alice", password: "pass1234" }, ctx);
      expect(result.user.display_name).toBe("alice");
    });

    it("重复用户名 → 409 USERNAME_TAKEN", async () => {
      await auth.register({ username: "alice", password: "pass1234" }, ctx);
      const err = await auth
        .register({ username: "alice", password: "pass5678" }, ctx)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(409);
      expect((err as ApiError).code).toBe("USERNAME_TAKEN");
    });
  });

  describe("登录", () => {
    it("正确账密登录成功返回 TokenPair", async () => {
      await auth.register({ username: "alice", password: "pass1234" }, ctx);
      const result = await auth.login({ username: "alice", password: "pass1234" }, ctx);
      expect(tokenPairSchema.safeParse(result.tokens).success).toBe(true);
      expect(result.user.username).toBe("alice");
    });

    it("密码错误 → 401 INVALID_CREDENTIALS", async () => {
      await auth.register({ username: "alice", password: "pass1234" }, ctx);
      const err = await auth
        .login({ username: "alice", password: "wrong123" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("INVALID_CREDENTIALS");
    });

    it("用户不存在 → 401 INVALID_CREDENTIALS（与密码错误同码，防账号枚举）", async () => {
      const err = await auth
        .login({ username: "ghost", password: "pass1234" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("INVALID_CREDENTIALS");
      expect((err as ApiError).message).toBe("用户名或密码不正确");
    });

    it("连续失败 10 次后锁定：第 10 次返回 429 LOGIN_LOCKED", async () => {
      await auth.register({ username: "alice", password: "pass1234" }, ctx);
      for (let i = 0; i < 9; i++) {
        // oxlint-disable-next-line no-await-in-loop -- 测试必须串行累计失败次数
        const err = await auth
          .login({ username: "alice", password: "wrong123" }, ctx)
          .catch((e: unknown) => e);
        expect((err as ApiError).code).toBe("INVALID_CREDENTIALS");
      }
      const tenth = await auth
        .login({ username: "alice", password: "wrong123" }, ctx)
        .catch((e: unknown) => e);
      expect((tenth as ApiError).code).toBe("LOGIN_LOCKED");
      expect((tenth as ApiError).statusCode).toBe(429);
    });

    it("锁定期间即使密码正确也拒绝（LOGIN_LOCKED）", async () => {
      await auth.register({ username: "alice", password: "pass1234" }, ctx);
      for (let i = 0; i < 10; i++) {
        // oxlint-disable-next-line no-await-in-loop -- 测试必须串行累计失败次数
        await auth.login({ username: "alice", password: "wrong123" }, ctx).catch(() => undefined);
      }
      const err = await auth
        .login({ username: "alice", password: "pass1234" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("LOGIN_LOCKED");
    });

    it("禁用用户即使密码正确也 → 403 USER_DISABLED", async () => {
      const { user } = await auth.register({ username: "alice", password: "pass1234" }, ctx);
      await db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id));
      const err = await auth
        .login({ username: "alice", password: "pass1234" }, ctx)
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("USER_DISABLED");
      expect((err as ApiError).statusCode).toBe(403);
    });
  });

  describe("会话管理", () => {
    it("refresh 正常轮换发新 TokenPair", async () => {
      const { tokens: first } = await auth.register(
        { username: "alice", password: "pass1234" },
        ctx,
      );
      const next = await auth.refresh(first.refresh_token);
      expect(tokenPairSchema.safeParse(next).success).toBe(true);
      expect(next.refresh_token).not.toBe(first.refresh_token);
    });

    it("logout 后旧 refresh 串失效", async () => {
      const { tokens: pair } = await auth.register(
        { username: "alice", password: "pass1234" },
        ctx,
      );
      await auth.logout(pair.refresh_token);
      const err = await auth.refresh(pair.refresh_token).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("REFRESH_REUSED");
    });

    it("logout-all 吊销该用户全部会话", async () => {
      const { user, tokens: a } = await auth.register(
        { username: "alice", password: "pass1234" },
        ctx,
      );
      const { tokens: b } = await auth.login({ username: "alice", password: "pass1234" }, ctx);
      await auth.logoutAll(user.id);
      expect(
        ((await auth.refresh(a.refresh_token).catch((e: unknown) => e)) as ApiError).code,
      ).toBe("REFRESH_REUSED");
      expect(
        ((await auth.refresh(b.refresh_token).catch((e: unknown) => e)) as ApiError).code,
      ).toBe("REFRESH_REUSED");
    });
  });

  describe("改密 / 设密", () => {
    it("旧密码错误 → 401 INVALID_CREDENTIALS", async () => {
      const { user } = await auth.register({ username: "alice", password: "pass1234" }, ctx);
      const err = await auth
        .changePassword(user.id, { old_password: "wrong123", new_password: "newpass99" })
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("INVALID_CREDENTIALS");
    });

    it("有密码账号缺 old_password → 400 VALIDATION_FAILED", async () => {
      const { user } = await auth.register({ username: "alice", password: "pass1234" }, ctx);
      const err = await auth
        .changePassword(user.id, { new_password: "newpass99" })
        .catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("VALIDATION_FAILED");
    });

    it("改密成功 → 旧会话全端下线（refresh 失效）", async () => {
      const { user, tokens: pair } = await auth.register(
        { username: "alice", password: "pass1234" },
        ctx,
      );
      await auth.changePassword(user.id, { old_password: "pass1234", new_password: "newpass99" });
      const err = await auth.refresh(pair.refresh_token).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("REFRESH_REUSED");
      // 新密码可登录
      const relogin = await auth.login({ username: "alice", password: "newpass99" }, ctx);
      expect(relogin.user.id).toBe(user.id);
    });

    it("UC-only 账号（无本地密码）免 old_password 设置本地密码，设密后变混合账号", async () => {
      const ucOnly = await insertUser(db, { username: "uc_user" }); // 无密码
      await insertUcIdentity(db, ucOnly.id, "uc-sub-1");
      await auth.changePassword(ucOnly.id, { new_password: "newpass99" });
      const me = await auth.getMe(ucOnly.id);
      expect(me.has_password).toBe(true);
      const login = await auth.login({ username: "uc_user", password: "newpass99" }, ctx);
      expect(login.user.id).toBe(ucOnly.id);
    });
  });

  describe("个人资料", () => {
    it("getMe 返回 User 契约（UC-only 账号 has_password=false / has_uc_identity=true）", async () => {
      const ucOnly = await insertUser(db, { username: "uc_user" });
      await insertUcIdentity(db, ucOnly.id, "uc-sub-1");
      const me = await auth.getMe(ucOnly.id);
      expect(userSchema.safeParse(me).success).toBe(true);
      expect(me.has_password).toBe(false);
      expect(me.has_uc_identity).toBe(true);
    });

    it("updateMe 修改 display_name 并返回最新 User", async () => {
      const { user } = await auth.register({ username: "alice", password: "pass1234" }, ctx);
      const updated = await auth.updateMe(user.id, { display_name: "新名字" });
      expect(updated.display_name).toBe("新名字");
      expect(updated.updated_at >= user.updated_at).toBe(true);
    });

    it("getMe 用户不存在 → 404 NOT_FOUND", async () => {
      const err = await auth.getMe(crypto.randomUUID()).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe("NOT_FOUND");
    });
  });
});
