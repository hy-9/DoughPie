/**
 * 全局枚举契约。状态机四态 P0 即预埋（PLAN.md §6.2）：UI 暂渲三列，review 带徽章归入进行中。
 */

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["high", "mid", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** workspace 级三角色（PLAN.md P0-5），与实例角色互不相干 */
export const WORKSPACE_ROLES = ["owner", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** 实例级角色（backend.md §2.8），首注册用户自动为 admin */
export const INSTANCE_ROLES = ["admin", "user"] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** 通知类型（PLAN.md §5.1 矩阵） */
export const NOTIFICATION_TYPES = [
  "mention",
  "assigned",
  "overdue",
  "progress",
  "due",
  "incomplete",
  "system",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** 通知三级刻度：🔴 高 / 🟠 中 / ⚪ 低 */
export const NOTIFICATION_LEVELS = ["high", "mid", "low"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

/** 任务级关注档位（PLAN.md §5.6） */
export const NOTIFY_MODES = ["all", "mentions_only", "muted"] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

/** 重复任务仅支持三种 freq（backend.md §4） */
export const RECURRENCE_FREQS = ["daily", "weekly", "monthly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];
