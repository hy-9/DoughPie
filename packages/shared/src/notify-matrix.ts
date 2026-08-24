import type { NotificationLevel, NotificationType } from "./enums.js";

/**
 * 通知「类型 × 等级 × 已读行为」默认映射（PLAN.md §5.1 矩阵）。
 * 用户可在设置页按类型调整等级（P1），等级决定推送策略（§5.2）。
 */

/** 已读行为：ack=手动点「收到」确认（永不自动已读）；manual=手动已读；auto=打开任务详情自动已读 */
export type ReadBehavior = "ack" | "manual" | "auto";

export interface NotificationTypeRule {
  level: NotificationLevel;
  readBehavior: ReadBehavior;
  /** 可关闭：是否允许任务级关闭该类型（mention/assigned/system 不可关） */
  closable: boolean;
}

export const DEFAULT_NOTIFICATION_RULES: Record<NotificationType, NotificationTypeRule> = {
  mention: { level: "high", readBehavior: "ack", closable: false },
  assigned: { level: "high", readBehavior: "manual", closable: false },
  overdue: { level: "high", readBehavior: "manual", closable: true },
  progress: { level: "mid", readBehavior: "auto", closable: true },
  due: { level: "mid", readBehavior: "manual", closable: true },
  incomplete: { level: "low", readBehavior: "manual", closable: true },
  system: { level: "mid", readBehavior: "manual", closable: false },
};

/**
 * 等级 → 推送策略绑定（PLAN.md §5.2，用户可改等级即改推送策略）：
 * 🔴 系统推送 + 站内；🟠 站内 + 推送可选；⚪ 仅站内。
 */
export const LEVEL_PUSH_POLICIES = ["push_required", "push_optional", "inapp_only"] as const;
export type LevelPushPolicy = (typeof LEVEL_PUSH_POLICIES)[number];

export const DEFAULT_LEVEL_PUSH_POLICY: Record<NotificationLevel, LevelPushPolicy> = {
  high: "push_required",
  mid: "push_optional",
  low: "inapp_only",
};

/** 便捷查询：某类型的默认等级 */
export function defaultLevelOf(type: NotificationType): NotificationLevel {
  return DEFAULT_NOTIFICATION_RULES[type].level;
}

/** 该类型通知是否永不自动已读（必须点「收到」） */
export function requiresAck(type: NotificationType): boolean {
  return DEFAULT_NOTIFICATION_RULES[type].readBehavior === "ack";
}
