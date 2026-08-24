import { randomBytes } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";
import { and, asc, count, eq, ne } from "drizzle-orm";
import {
  COPY,
  type AdminResetPasswordResult,
  type AdminUpdateUserBody,
  type User,
} from "@doughpie/shared";
import type { Db } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { userIdentities, users } from "../models/schema.js";
import type { TokenService } from "./token-service.js";
import { toUserDto } from "./user-dto.js";

/**
 * 实例管理（P0-16，backend.md §2.8）。仅实例 admin 可达（路由层 requireAdmin 把关）。
 * 审计日志在路由层用 req.log 输出（携带 request-id）；按既定决策不进 events 表（events 属 workspace 域）。
 */
export interface AdminServiceDeps {
  db: Db;
  tokenService: TokenService;
}

export type AdminService = ReturnType<typeof createAdminService>;

/** 临时密码：固定字母+数字前缀保证满足密码规则（≥8 位且含字母数字），后缀随机 */
function generateTempPassword(): string {
  return `Dp9-${randomBytes(9).toString("base64url")}`;
}

export function createAdminService(deps: AdminServiceDeps) {
  const { db, tokenService } = deps;

  async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, excludeUserId)));
    return row?.value ?? 0;
  }

  async function hasUcIdentity(userId: string): Promise<boolean> {
    const row = await db.query.userIdentities.findFirst({
      where: eq(userIdentities.userId, userId),
      columns: { id: true },
    });
    return row !== undefined;
  }

  return {
    /** 用户列表（用户名/昵称/状态/角色；来源 本地|uc 由 has_password/has_uc_identity 推导） */
    async listUsers(): Promise<User[]> {
      const rows = await db.select().from(users).orderBy(asc(users.createdAt));
      const identities = await db.select().from(userIdentities);
      const boundUserIds = new Set(identities.map((i) => i.userId));
      return rows.map((row) => toUserDto(row, boundUserIds.has(row.id)));
    },

    /** 改状态/角色；末位 admin 保护：降级或禁用最后一个活跃 admin → 409 */
    async updateUser(_actorId: string, targetId: string, body: AdminUpdateUserBody): Promise<User> {
      const target = await db.query.users.findFirst({ where: eq(users.id, targetId) });
      if (!target) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);

      const removesAdmin =
        (body.role !== undefined && body.role !== "admin" && target.role === "admin") ||
        (body.status === "disabled" && target.role === "admin" && target.status === "active");
      if (removesAdmin && (await countOtherActiveAdmins(targetId)) === 0) {
        throw new ApiError(409, "LAST_ADMIN", COPY.admin.lastAdmin);
      }

      const [updated] = await db
        .update(users)
        .set({
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.role !== undefined ? { role: body.role } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetId))
        .returning();
      if (!updated) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);

      // 禁用 → 吊销其全部本地会话（踢出 socket 房间属 D 阶段实时层）
      if (body.status === "disabled") {
        await tokenService.revokeAllUserSessions(targetId);
      }
      return toUserDto(updated, await hasUcIdentity(targetId));
    },

    /** 重置密码：一次性临时密码 + 吊销该用户全部会话 */
    async resetPassword(_actorId: string, targetId: string): Promise<AdminResetPasswordResult> {
      const target = await db.query.users.findFirst({
        where: eq(users.id, targetId),
        columns: { id: true },
      });
      if (!target) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      const tempPassword = generateTempPassword();
      await db
        .update(users)
        .set({ passwordHash: await argon2Hash(tempPassword), updatedAt: new Date() })
        .where(eq(users.id, targetId));
      await tokenService.revokeAllUserSessions(targetId);
      return { temp_password: tempPassword };
    },
  };
}
