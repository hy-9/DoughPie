import { z } from "zod";
import { WORKSPACE_ROLES } from "../enums.js";
import { WORKSPACE_NAME_MAX } from "../limits.js";

/**
 * 工作区与成员契约（PLAN.md P0-2/P0-5）。
 * 建区不限量，创建者即 owner；邀请链接默认 member（可选 viewer），7 天有效、可作废。
 */

export const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
});
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;

export const updateWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
});
export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceBodySchema>;

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  owner_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

/** 成员 DTO（join users 后的展示形态） */
export const memberSchema = z.object({
  user_id: z.string().uuid(),
  username: z.string(),
  display_name: z.string(),
  role: z.enum(WORKSPACE_ROLES),
  joined_at: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

/** 创建邀请链接：默认 member，可选 viewer（PLAN.md §8） */
export const createInviteBodySchema = z.object({
  role: z.enum(["member", "viewer"]).default("member"),
});
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;

export const inviteSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  /** 邀请码：拼接进链接 /invite/:code */
  code: z.string(),
  role: z.enum(["member", "viewer"]),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const acceptInviteBodySchema = z.object({
  code: z.string().min(1),
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBodySchema>;

/** 邀请预览（接受前展示，PLAN.md §8：默认 member 可选 viewer；7 天有效） */
export const inviteInfoSchema = z.object({
  workspace_id: z.string().uuid(),
  workspace_name: z.string(),
  role: z.enum(["member", "viewer"]),
  expires_at: z.string(),
});
export type InviteInfo = z.infer<typeof inviteInfoSchema>;

/** 成员角色变更：owner 转让是 P1，P0 只允许 member ↔ viewer */
export const updateMemberRoleBodySchema = z.object({
  role: z.enum(["member", "viewer"]),
});
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBodySchema>;
