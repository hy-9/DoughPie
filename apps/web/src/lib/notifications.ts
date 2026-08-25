import type {
  Notification,
  NotificationGroup,
  NotificationLevel,
  NotificationType,
} from "@doughpie/shared";

/**
 * 通知中心辅助（PLAN.md §5.4/§5.5，简版）：
 * 服务端按游标返回扁平列表，「按任务分组聚合」在前端完成（shared 已定义 NotificationGroup 契约形状）。
 */

/** 等级权重：组徽标取组内最高等级（high > mid > low） */
const LEVEL_RANK: Record<NotificationLevel, number> = { high: 2, mid: 1, low: 0 };

/** 通知类型 → 展示文案（类型图标在组件层映射） */
export const NOTIFICATION_TYPE_TEXT: Record<NotificationType, string> = {
  mention: "提及了你",
  assigned: "将你设为负责人",
  overdue: "任务已逾期",
  progress: "任务有新进展",
  due: "截止临近",
  incomplete: "未完成任务汇总",
  system: "系统通知",
};

/** 深链用：通知关联的任务 id（payload.task_id 优先，task 实体兜底） */
export function notificationTaskId(n: Notification): string | null {
  const t = n.payload["task_id"];
  if (typeof t === "string") return t;
  return n.entity === "task" ? n.entity_id : null;
}

/** 深链锚点：评论通知携带 comment_id */
export function notificationCommentId(n: Notification): string | null {
  const c = n.payload["comment_id"];
  return typeof c === "string" ? c : null;
}

/** 通知摘要文本（评论摘录等） */
export function notificationExcerpt(n: Notification): string | null {
  const e = n.payload["excerpt"];
  return typeof e === "string" && e.length > 0 ? e : null;
}

/** 任务标题（部分事件 payload 带 title；多数不带，组头降级为「任务」） */
export function notificationTaskTitle(n: Notification): string | null {
  const t = n.payload["title"];
  return typeof t === "string" && t.length > 0 ? t : null;
}

/**
 * 按任务分组聚合：同任务 N 条折叠为一组（§5.4）。
 * - 组内 items 按创建时间倒序；组间按组内最新一条倒序
 * - unread_count 只计未读；top_level 取组内最高等级
 * - 无任务归属的通知（如系统类）各自成组，不互相折叠
 */
export function groupNotifications(items: Notification[]): NotificationGroup[] {
  const byTask = new Map<string, Notification[]>();
  for (const n of items) {
    const taskId = notificationTaskId(n);
    const key = taskId ?? `__ungrouped__:${n.id}`;
    const bucket = byTask.get(key);
    if (bucket) bucket.push(n);
    else byTask.set(key, [n]);
  }

  const groups: NotificationGroup[] = [];
  for (const bucket of byTask.values()) {
    const sorted = bucket.toSorted((a, b) => b.created_at.localeCompare(a.created_at));
    const first = sorted[0];
    if (!first) continue;
    const taskId = notificationTaskId(first);
    let top: NotificationLevel = "low";
    let unread = 0;
    for (const n of sorted) {
      if (LEVEL_RANK[n.level] > LEVEL_RANK[top]) top = n.level;
      if (!n.read_at) unread += 1;
    }
    groups.push({
      task_id: taskId,
      task_title: sorted.map(notificationTaskTitle).find((t) => t !== null) ?? null,
      unread_count: unread,
      top_level: top,
      items: sorted,
    });
  }
  // 组间：最新一条新的在前（created_at 为 ISO 串，字典序即时间序）
  groups.sort((a, b) => {
    const aFirst = a.items[0];
    const bFirst = b.items[0];
    return (bFirst?.created_at ?? "").localeCompare(aFirst?.created_at ?? "");
  });
  return groups;
}
