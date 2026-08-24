import { z } from "zod";
import { NOTIFICATION_LEVELS, NOTIFICATION_TYPES } from "../enums.js";
import { cursorQuerySchema, uuidSchema } from "./common.js";

/**
 * 通知契约（PLAN.md §5）。数据模型 P0 带全；推送通道 E 阶段接通。
 * 每条通知都是深链：payload 携带跳转所需信息（任务/评论锚点）。
 */

export const notificationSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  workspace_id: uuidSchema,
  type: z.enum(NOTIFICATION_TYPES),
  level: z.enum(NOTIFICATION_LEVELS),
  /** 关联实体（如 task/comment），深链用 */
  entity: z.string(),
  entity_id: uuidSchema,
  /** 触发者（谁 @了我 / 谁分配的） */
  actor_id: uuidSchema.nullable(),
  /** 深链载荷：{ task_id, comment_id?, list_id?, excerpt? } 等 */
  payload: z.record(z.unknown()),
  read_at: z.string().nullable(),
  /** 提及确认时间（mention 类型闭环，PLAN.md §5.5） */
  ack_at: z.string().nullable(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationQuerySchema = cursorQuerySchema.extend({
  /** 注意：不能用 z.coerce.boolean()（'false' 会被转成 true）；query 串显式 'true'/'false' */
  unread_only: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  level: z.enum(NOTIFICATION_LEVELS).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const markReadBodySchema = z.object({
  ids: z.array(uuidSchema).min(1).max(100),
});
export type MarkReadBody = z.infer<typeof markReadBodySchema>;

/** 通知中心按任务分组聚合（PLAN.md §5.4）：同任务 N 条折叠为一组 */
export const notificationGroupSchema = z.object({
  task_id: uuidSchema.nullable(),
  task_title: z.string().nullable(),
  unread_count: z.number().int(),
  /** 组内最高等级（用于组徽标） */
  top_level: z.enum(NOTIFICATION_LEVELS),
  items: z.array(notificationSchema),
});
export type NotificationGroup = z.infer<typeof notificationGroupSchema>;
