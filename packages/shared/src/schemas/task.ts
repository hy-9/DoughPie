import { z } from "zod";
import { PRIORITIES, RECURRENCE_FREQS, TASK_STATUSES } from "../enums.js";
import { DESCRIPTION_MAX, TITLE_MAX } from "../limits.js";
import { cursorQuerySchema, isoDateTimeSchema, uuidSchema } from "./common.js";

/**
 * 任务契约（PLAN.md P0-4/P0-10/P0-14/P0-15，backend.md §3/§4）。
 * 写操作走 If-Match: version 乐观锁（header，不在 body），冲突 409 强制 refetch。
 */

/** 重复规则（backend.md §4）：基准=计划时间；monthly 月末 clamp；仅 done 触发下一实例 */
export const recurrenceRuleSchema = z
  .object({
    freq: z.enum(RECURRENCE_FREQS),
    interval: z.number().int().min(1).max(99).default(1),
    /** 仅 weekly 可用：0=周日 … 6=周六（UTC） */
    by_weekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    until: isoDateTimeSchema.optional(),
  })
  .refine((v) => v.freq === "weekly" || v.by_weekday === undefined, {
    message: "by_weekday 仅 weekly 可用",
  });
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const createTaskBodySchema = z.object({
  list_id: uuidSchema,
  title: z.string().trim().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  assignee_id: uuidSchema.nullable().optional(),
  priority: z.enum(PRIORITIES).default("none"),
  start_at: isoDateTimeSchema.nullable().optional(),
  due_at: isoDateTimeSchema.nullable().optional(),
  remind_at: isoDateTimeSchema.nullable().optional(),
  recurrence: recurrenceRuleSchema.nullable().optional(),
});
export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;

/** 状态流转、字段修改、跨清单移动统一走 PATCH + If-Match */
export const updateTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
    assignee_id: uuidSchema.nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    start_at: isoDateTimeSchema.nullable().optional(),
    due_at: isoDateTimeSchema.nullable().optional(),
    remind_at: isoDateTimeSchema.nullable().optional(),
    recurrence: recurrenceRuleSchema.nullable().optional(),
    list_id: uuidSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "至少修改一项" });
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;

/** 任务 DTO：deleted_at 不进 DTO（回收站 P1，查询默认滤掉软删） */
export const taskSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  list_id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  assignee_id: uuidSchema.nullable(),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  start_at: z.string().nullable(),
  due_at: z.string().nullable(),
  remind_at: z.string().nullable(),
  recurrence: recurrenceRuleSchema.nullable(),
  sort_order: z.number(),
  version: z.number().int(),
  completed_at: z.string().nullable(),
  completed_by: uuidSchema.nullable(),
  created_by: uuidSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const subtaskSchema = z.object({
  id: uuidSchema,
  task_id: uuidSchema,
  title: z.string(),
  done: z.boolean(),
  sort_order: z.number(),
  created_at: z.string(),
});
export type Subtask = z.infer<typeof subtaskSchema>;

export const createSubtaskBodySchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
});
export type CreateSubtaskBody = z.infer<typeof createSubtaskBodySchema>;

export const updateSubtaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(TITLE_MAX).optional(),
    done: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.done !== undefined, { message: "至少修改一项" });
export type UpdateSubtaskBody = z.infer<typeof updateSubtaskBodySchema>;

/**
 * 任务查询：智能视图（P0-14）+ 四筛 + 排序切换（P0-15）。
 * view 与筛选可叠加（view 是先置条件集）。
 */
export const taskQuerySchema = cursorQuerySchema.extend({
  view: z.enum(["today", "mine", "overdue"]).optional(),
  /**
   * 设备本地时区偏移（分钟，同 Date.getTimezoneOffset()：UTC+8 = -480）。
   * 仅 view=today 使用：服务端按「当地今天」换算 UTC 区间（PLAN.md §8：UTC 存储 + 设备本地时区显示）。
   * 缺省按 UTC 天。
   */
  tz_offset: z.coerce.number().int().min(-840).max(840).optional(),
  list_id: uuidSchema.optional(),
  assignee_id: uuidSchema.optional(),
  status: z.union([z.enum(TASK_STATUSES), z.array(z.enum(TASK_STATUSES))]).optional(),
  priority: z.union([z.enum(PRIORITIES), z.array(z.enum(PRIORITIES))]).optional(),
  due_from: isoDateTimeSchema.optional(),
  due_to: isoDateTimeSchema.optional(),
  /** 全文搜索（P0-11，ILIKE 标题+描述） */
  q: z.string().trim().min(1).max(200).optional(),
  sort: z
    .enum(["sort_order", "due_at", "priority", "created_at", "updated_at"])
    .default("sort_order"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;
