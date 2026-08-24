import { z } from "zod";
import { INSTANCE_ROLES, USER_STATUSES } from "../enums.js";
import {
  DISPLAY_NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
} from "../limits.js";

/**
 * 认证与用户契约（backend.md §2）。
 * 双模式：本地账密自含 + UC SSO 可选联邦；两种通道发同一种自签会话令牌。
 */

/** 用户名：≥2 字符可中文；字母/数字/中文/._- */
export const usernameSchema = z
  .string()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(/^[A-Za-z0-9_.\-一-龥]+$/, "用户名仅支持字母、数字、中文、._-");

/** 密码 ≥8 位且含字母+数字（与 UC 一致） */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .max(PASSWORD_MAX)
  .regex(/^(?=.*[A-Za-z])(?=.*\d)/, "密码需同时包含字母和数字");

export const registerBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  display_name: z.string().min(1).max(DISPLAY_NAME_MAX).optional(),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

/** 改密/设密：UC-only 账号无旧密码（password_hash 为空时服务端免验 old_password） */
export const changePasswordBodySchema = z.object({
  old_password: z.string().min(1).optional(),
  new_password: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

/** SSO 首登选择页（backend.md §2.4）：pending_sso 票据 5 分钟一次性 */
export const ssoLinkBodySchema = z.object({
  pending_token: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type SsoLinkBody = z.infer<typeof ssoLinkBodySchema>;

export const ssoRegisterBodySchema = z.object({
  pending_token: z.string().min(1),
  /** 预填 UC username（可改，冲突加后缀） */
  username: usernameSchema,
  display_name: z.string().min(1).max(DISPLAY_NAME_MAX).optional(),
});
export type SsoRegisterBody = z.infer<typeof ssoRegisterBodySchema>;

/** 会话令牌对：access 自签 JWT（30min）+ refresh 不透明串（30 天滑动/轮换/重用检测） */
export const tokenPairSchema = z.object({
  access_token: z.string(),
  /** access token 寿命（秒） */
  expires_in: z.number().int(),
  refresh_token: z.string(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

/** SSO callback 无绑定时的响应：不发 token，发改签票据引导选择页 */
export const ssoPendingSchema = z.object({
  pending_token: z.string(),
  /** 预填信息（来自 UC userinfo：{id, username, role, client_id}，无 email/头像） */
  suggested_username: z.string(),
  expires_in: z.number().int(),
});
export type SsoPending = z.infer<typeof ssoPendingSchema>;

/** 用户 DTO（不含 password_hash） */
export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  display_name: z.string(),
  status: z.enum(USER_STATUSES),
  role: z.enum(INSTANCE_ROLES),
  /** 是否已绑定 UC 身份（设置页绑定/解绑入口） */
  has_uc_identity: z.boolean(),
  /** 是否有本地密码（UC-only 账号为 false，可补设变混合账号） */
  has_password: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const updateMeBodySchema = z.object({
  display_name: z.string().min(1).max(DISPLAY_NAME_MAX),
});
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>;

/** 实例管理（P0-16，backend.md §2.8）：admin 操作用户 */
export const adminUpdateUserBodySchema = z
  .object({
    status: z.enum(USER_STATUSES).optional(),
    role: z.enum(INSTANCE_ROLES).optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, {
    message: "至少修改一项",
  });
export type AdminUpdateUserBody = z.infer<typeof adminUpdateUserBodySchema>;

/** admin 重置密码响应：一次性临时密码 */
export const adminResetPasswordResultSchema = z.object({
  temp_password: z.string(),
});
export type AdminResetPasswordResult = z.infer<typeof adminResetPasswordResultSchema>;
