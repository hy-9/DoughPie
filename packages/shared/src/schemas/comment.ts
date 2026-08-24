import { z } from "zod";
import { TASK_STATUSES } from "../enums.js";
import { COMMENT_MAX } from "../limits.js";
import { cursorQuerySchema, uuidSchema } from "./common.js";

/**
 * 讨论区契约（PLAN.md §6.1，P0-17 基础版）：评论 + 一级回复 + @提及 + 提及确认闭环。
 * 每条评论记录发表时的任务状态（state_at_comment），永久沉淀。
 */

export const createCommentBodySchema = z.object({
  content: z.string().trim().min(1).max(COMMENT_MAX),
  /** 一级回复：parent 必须是顶层评论（服务端校验，拒绝二级嵌套） */
  parent_id: uuidSchema.optional(),
});
export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;

export const updateCommentBodySchema = z.object({
  content: z.string().trim().min(1).max(COMMENT_MAX),
});
export type UpdateCommentBody = z.infer<typeof updateCommentBodySchema>;

/** 评论内 @提及的确认状态（PLAN.md §5.5 闭环展示：@B✅已确认 / @D⏳待确认） */
export const commentMentionSchema = z.object({
  user_id: uuidSchema,
  username: z.string(),
  display_name: z.string(),
  /** null = 待确认；有值 = 已确认时间 */
  acked_at: z.string().nullable(),
});
export type CommentMention = z.infer<typeof commentMentionSchema>;

/** 评论 DTO：删除留 tombstone（deleted=true 时 content 由服务端置空串） */
export const commentSchema = z.object({
  id: uuidSchema,
  task_id: uuidSchema,
  author_id: uuidSchema,
  author_username: z.string(),
  author_display_name: z.string(),
  parent_id: uuidSchema.nullable(),
  content: z.string(),
  /** 发表时的任务状态（PLAN.md §6.1，P1 按状态分段过滤用） */
  state_at_comment: z.enum(TASK_STATUSES),
  edited_at: z.string().nullable(),
  deleted: z.boolean(),
  mentions: z.array(commentMentionSchema),
  created_at: z.string(),
});
export type Comment = z.infer<typeof commentSchema>;

export const commentQuerySchema = cursorQuerySchema;
export type CommentQuery = z.infer<typeof commentQuerySchema>;
