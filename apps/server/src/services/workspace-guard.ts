import { and, eq } from "drizzle-orm";
import { COPY } from "@doughpie/shared";
import type { Db } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { memberships, type MembershipRow } from "../models/schema.js";
import { can, type WorkspaceAction } from "./permission.js";

/**
 * 工作区成员守卫（backend.md §7：service 层每个方法入口校验，非仅路由层）。
 * 非成员与无权限统一 403 FORBIDDEN（不暴露资源存在性细节之外的额外信息）。
 */

/** 取成员关系；非成员 → 403 */
export async function requireMembership(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<MembershipRow> {
  const row = await db.query.memberships.findFirst({
    where: and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)),
  });
  if (!row) throw new ApiError(403, "FORBIDDEN", COPY.common.forbidden);
  return row;
}

/** 取成员关系并校验动作权限；非成员或越权 → 403 */
export async function requireCan(
  db: Db,
  workspaceId: string,
  userId: string,
  action: WorkspaceAction,
): Promise<MembershipRow> {
  const membership = await requireMembership(db, workspaceId, userId);
  if (!can(membership.role, action)) {
    throw new ApiError(403, "FORBIDDEN", COPY.common.forbidden);
  }
  return membership;
}
