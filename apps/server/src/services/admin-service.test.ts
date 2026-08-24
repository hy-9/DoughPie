import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { passwordSchema, userSchema } from "@doughpie/shared";
import type { Db } from "../db.js";
import { createTestDb, testEnv, truncateAll } from "../../tests/helpers.js";
import { insertUcIdentity, insertUser } from "../../tests/factories.js";
import { ApiError } from "../lib/api-error.js";
import { createAdminService, type AdminService } from "./admin-service.js";
import { createAuthService } from "./auth-service.js";
import { LoginGuard } from "./login-guard.js";
import { createTokenService, type TokenService } from "./token-service.js";

/**
 * L2 实例管理（P0-16，backend.md §2.8）：列表/禁用/重置密码/角色切换，
 * 首注册用户为 admin，降级/禁用最后一个 admin → 409 LAST_ADMIN。
 */
describe("adminService 实例管理（L2）", () => {
  let db: Db;
  let close: () => Promise<void>;
  let admin: AdminService;
  let tokens: TokenService;
  const ctx = { ip: "10.0.0.1", deviceInfo: "vitest" };

  function authService() {
    return createAuthService({
      db,
      tokenService: tokens,
      loginGuard: new LoginGuard({ maxFailures: 10, lockMinutes: 15 }),
      loginLockMinutes: 15,
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
    admin = createAdminService({ db, tokenService: tokens });
  });

  afterEach(async () => {
    await close();
  });

  it("用户列表：含来源标识（has_uc_identity）与状态/角色", async () => {
    await insertUser(db, { username: "admin1", password: "pass1234", role: "admin" });
    const ucUser = await insertUser(db, { username: "uc_user" });
    await insertUcIdentity(db, ucUser.id, "uc-sub-9");
    const list = await admin.listUsers();
    expect(list).toHaveLength(2);
    for (const item of list) expect(userSchema.safeParse(item).success).toBe(true);
    const uc = list.find((u) => u.username === "uc_user");
    expect(uc?.has_uc_identity).toBe(true);
    expect(uc?.has_password).toBe(false);
  });

  it("禁用用户 → 吊销其全部本地会话", async () => {
    const adminUser = await insertUser(db, { username: "admin1", role: "admin" });
    const target = await insertUser(db, { username: "alice" });
    const { sessionId } = await tokens.issueSession(target.id);

    const updated = await admin.updateUser(adminUser.id, target.id, { status: "disabled" });
    expect(updated.status).toBe("disabled");
    expect(await tokens.isSessionAlive(sessionId)).toBe(false);
  });

  it("重新启用用户 → status 恢复 active", async () => {
    const adminUser = await insertUser(db, { username: "admin1", role: "admin" });
    const target = await insertUser(db, { username: "alice", status: "disabled" });
    const updated = await admin.updateUser(adminUser.id, target.id, { status: "active" });
    expect(updated.status).toBe("active");
  });

  it("提升普通用户为 admin", async () => {
    const adminUser = await insertUser(db, { username: "admin1", role: "admin" });
    const target = await insertUser(db, { username: "alice" });
    const updated = await admin.updateUser(adminUser.id, target.id, { role: "admin" });
    expect(updated.role).toBe("admin");
  });

  it("降级最后一个 admin → 409 LAST_ADMIN", async () => {
    const adminUser = await insertUser(db, { username: "admin1", role: "admin" });
    const err = await admin
      .updateUser(adminUser.id, adminUser.id, { role: "user" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(409);
    expect((err as ApiError).code).toBe("LAST_ADMIN");
    expect((err as ApiError).message).toBe("至少需要保留一名管理员");
  });

  it("禁用最后一个 admin → 409 LAST_ADMIN（等效于降级）", async () => {
    const adminUser = await insertUser(db, { username: "admin1", role: "admin" });
    const err = await admin
      .updateUser(adminUser.id, adminUser.id, { status: "disabled" })
      .catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("LAST_ADMIN");
  });

  it("存在其他活跃 admin 时可正常降级", async () => {
    const a1 = await insertUser(db, { username: "admin1", role: "admin" });
    const a2 = await insertUser(db, { username: "admin2", role: "admin" });
    const updated = await admin.updateUser(a1.id, a2.id, { role: "user" });
    expect(updated.role).toBe("user");
  });

  it("操作不存在的用户 → 404 NOT_FOUND", async () => {
    const adminUser = await insertUser(db, { username: "admin1", role: "admin" });
    const err = await admin
      .updateUser(adminUser.id, crypto.randomUUID(), { status: "disabled" })
      .catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("NOT_FOUND");
  });

  it("重置密码 → 返回符合规则的一次性临时密码，旧会话全吊销，可用临时密码登录", async () => {
    const adminUser = await insertUser(db, { username: "admin1", role: "admin" });
    const target = await insertUser(db, { username: "alice", password: "oldpass123" });
    const { sessionId } = await tokens.issueSession(target.id);

    const { temp_password } = await admin.resetPassword(adminUser.id, target.id);
    expect(passwordSchema.safeParse(temp_password).success).toBe(true);
    expect(await tokens.isSessionAlive(sessionId)).toBe(false);

    // 临时密码可直接登录，随后改密生效
    const auth = authService();
    const login = await auth.login({ username: "alice", password: temp_password }, ctx);
    expect(login.user.id).toBe(target.id);
    await auth.changePassword(target.id, {
      old_password: temp_password,
      new_password: "newpass99",
    });
    const relogin = await auth.login({ username: "alice", password: "newpass99" }, ctx);
    expect(relogin.user.id).toBe(target.id);
  });
});
