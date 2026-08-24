/**
 * 扁平错误码契约：{ code, message } + 标准 HTTP 码（conventions.md §3.2，与 UC 风格一致）。
 * 新增错误码属于契约变更，先改 PLAN.md/专项文档再动这里。
 */

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "TOKEN_EXPIRED",
  "REFRESH_REUSED",
  "FORBIDDEN",
  "NOT_FOUND",
  "USERNAME_TAKEN",
  "INVALID_CREDENTIALS",
  "LOGIN_LOCKED",
  "USER_DISABLED",
  /** 乐观锁冲突：If-Match 版本不符，客户端强制 refetch（PLAN.md §4） */
  "VERSION_CONFLICT",
  "INVITE_INVALID",
  "INVITE_EXPIRED",
  "ALREADY_MEMBER",
  /** 末位保护：最后一个实例 admin / 工作区 owner 不可降级（backend.md §2.8） */
  "LAST_ADMIN",
  "LAST_OWNER",
  "PENDING_SSO_EXPIRED",
  "IDENTITY_BOUND",
  /** 解绑保护：无本地密码且仅剩该身份时禁止解绑（backend.md §2.4） */
  "UNBIND_FORBIDDEN",
  "SUBTASK_LIMIT",
  "RECURRENCE_INVALID",
  /** 提及「再提醒」24h 节流（PLAN.md §5.5：同一发起人对同一提及 24h 限一次），HTTP 429 */
  "REMIND_THROTTLED",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
}
