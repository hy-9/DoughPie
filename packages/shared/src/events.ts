import { z } from "zod";

/**
 * events 表事件目录：一石四鸟（断线补齐/动态流/审计/通知引擎数据源，PLAN.md §4）。
 * 所有业务写必须与事件写在同一事务内（AGENTS.md 关键设计约束）。
 */
export const EVENT_TYPES = [
  "workspace.created",
  "workspace.updated",
  "member.joined",
  "member.left",
  "member.removed",
  "member.role_changed",
  "list.created",
  "list.updated",
  "list.deleted",
  "list.reordered",
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.deleted",
  "task.restored",
  "task.reordered",
  "subtask.created",
  "subtask.updated",
  "subtask.deleted",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "mention.acked",
  "mention.reminded",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_ENTITIES = [
  "workspace",
  "member",
  "list",
  "task",
  "subtask",
  "comment",
  "notification",
] as const;
export type EventEntity = (typeof EVENT_ENTITIES)[number];

/**
 * 事件信封。id 为 int8 bigserial（全局单调=游标），JSON 中序列化为 string 防精度丢失；
 * 断线重连 GET /events?cursor=<id> 补齐（正确性只依赖游标，PLAN.md §4）。
 */
export const eventEnvelopeSchema = z.object({
  id: z.string(),
  workspace_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  entity: z.enum(EVENT_ENTITIES),
  entity_id: z.string().uuid(),
  /** 变更载荷：实体快照或差异字段，按事件类型约定，消费方做精确缓存失效 */
  payload: z.record(z.unknown()),
  created_at: z.string(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
