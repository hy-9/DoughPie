// 注意：只能 import type（编译期擦除）。drizzle-kit 以 CJS require 加载本文件，
// 而 @doughpie/shared 是 ESM-only 包，运行时导入会导致 ERR_PACKAGE_PATH_NOT_EXPORTED。
import type {
  EventEntity,
  EventType,
  InstanceRole,
  NotificationLevel,
  NotificationType,
  NotifyMode,
  Priority,
  RecurrenceRule,
  TaskStatus,
  UserStatus,
  WorkspaceRole,
} from "@doughpie/shared";
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * 双模式用户体系数据模型（backend.md §2.2）。
 * 主键 UUIDv7 由应用层生成（uuid 包），DB 侧不设默认值；
 * 时间一律 timestamptz 存 UTC。枚举取值以 shared/enums.ts 冻结契约为准（$type 收窄）。
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    // 全局唯一（≥2 字符可中文），唯一索引保证并发注册不撞名
    username: text("username").notNull(),
    // 可空 = UC-only 账号（可补设本地密码变混合账号）
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active").$type<UserStatus>(),
    // 实例级角色，与 workspace 角色互不相干
    role: text("role").notNull().default("user").$type<InstanceRole>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_username_key").on(t.username)],
);

/** 外部身份绑定（当前仅 UC）；unique(provider, provider_user_id) 保证一个 UC 号只绑一个本地用户 */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().$type<"uc">(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_identities_provider_uid_key").on(t.provider, t.providerUserId),
    index("user_identities_user_id_idx").on(t.userId),
  ],
);

/**
 * refresh token 只存 SHA-256 哈希（泄露不可还原）；
 * 每次刷新轮换：旧行 revoked + 新行（同 session_id），旧行保留用于重用检测；
 * 滑动过期 = 当前活跃行 created_at + REFRESH_TOKEN_TTL_DAYS。
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 会话标识：一次登录一条 session，access JWT 的 sid 指向它，吊销即全端下线
    sessionId: uuid("session_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    // 设备信息（User-Agent 等），供会话管理展示
    deviceInfo: text("device_info"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("refresh_tokens_token_hash_key").on(t.tokenHash),
    index("refresh_tokens_session_id_idx").on(t.sessionId),
    index("refresh_tokens_user_id_idx").on(t.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserIdentityRow = typeof userIdentities.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

// ============================================================
// B2 领域模型（backend.md §3）。所有业务写必须与 events 同事务（AGENTS.md 关键设计约束）。
// ============================================================

/** 工作区（P0-2）：建区不限量，创建者即 owner（memberships 同步落一行 owner） */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** 成员关系：workspace 级三角色 owner/member/viewer（P0-5），与实例角色互不相干 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<WorkspaceRole>(),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_workspace_key").on(t.userId, t.workspaceId),
    index("memberships_workspace_idx").on(t.workspaceId),
  ],
);

/** 邀请链接（PLAN.md §8）：默认 member 可选 viewer；7 天有效、不限次数、可作废 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    role: text("role").notNull().$type<Extract<WorkspaceRole, "member" | "viewer">>(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invites_code_key").on(t.code),
    index("invites_workspace_idx").on(t.workspaceId),
  ],
);

/** 清单（P0-3）：color hex 可空；sort_order 间隙值（SORT_GAP=1000），手动排序后写者胜 */
export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: doublePrecision("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("lists_workspace_idx").on(t.workspaceId, t.sortOrder)],
);

/**
 * 任务（P0-4，backend.md §3）：四态预埋 + 软删除 + version 乐观锁。
 * recurrence 规则见 backend.md §4（仅 done 触发下一实例；review 不算完成）。
 * sort_order 为 double：间隙算法取中位会产生小数，耗尽（<1）时整列重排回 1000 的倍数。
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    status: text("status").notNull().default("todo").$type<TaskStatus>(),
    priority: text("priority").notNull().default("none").$type<Priority>(),
    startAt: timestamp("start_at", { withTimezone: true, mode: "date" }),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }),
    remindAt: timestamp("remind_at", { withTimezone: true, mode: "date" }),
    recurrence: jsonb("recurrence").$type<RecurrenceRule>(),
    // 防重触发标记：本实例已生成过后继即为 true（重开再完成不重复生成；backend.md §4）
    recurrenceSpawned: boolean("recurrence_spawned").notNull().default(false),
    sortOrder: doublePrecision("sort_order").notNull(),
    // 乐观锁版本号：写操作必须 If-Match，命中则 version+1（PLAN.md §4）
    version: integer("version").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedBy: uuid("completed_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_workspace_idx").on(t.workspaceId, t.deletedAt),
    index("tasks_list_idx").on(t.listId, t.deletedAt, t.sortOrder),
    index("tasks_assignee_idx").on(t.workspaceId, t.assigneeId),
    index("tasks_due_at_idx").on(t.workspaceId, t.dueAt),
  ],
);

/** 子任务（P0-9）：仅标题+完成态；排序按创建序（间隙值），无需 move 端点 */
export const subtasks = pgTable(
  "subtasks",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    sortOrder: doublePrecision("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("subtasks_task_idx").on(t.taskId, t.sortOrder)],
);

/**
 * 评论（P0-17，PLAN.md §6.1）：一级回复（parent 必须是顶层）；编辑不限期（edited_at 标记）；
 * 删除留 tombstone（deleted_at 非空，DTO content 置空，回复仍在）。
 * state_at_comment 记录发表时任务状态，永久沉淀；mention_user_ids 为当前有效的 @提及集
 * （发表/编辑时重解析；确认状态 acked_at 从 mention 通知 join，不回写本表）。
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id),
    content: text("content").notNull(),
    stateAtComment: text("state_at_comment").notNull().$type<TaskStatus>(),
    mentionUserIds: jsonb("mention_user_ids").notNull().$type<string[]>(),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("comments_task_idx").on(t.taskId, t.createdAt)],
);

/**
 * events 一石四鸟（断线补齐/动态流/审计/通知数据源，PLAN.md §4）。
 * id bigserial 全局单调 = 游标；JSON 序列化为 string 防 int8 精度丢失。
 * 所有业务写必须在同一事务内调用 writeEvent（src/services/event-service.ts）。
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull().$type<EventType>(),
    entity: text("entity").notNull().$type<EventEntity>(),
    entityId: uuid("entity_id").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("events_workspace_idx").on(t.workspaceId, t.id)],
);

/**
 * 通知（PLAN.md §5，backend.md §3）：每条独立 read_at；mention 类另有 ack_at（确认闭环）。
 * payload 为深链载荷（task_id/comment_id/excerpt 等）。推送通道 E 阶段接通（本轮仅站内落库）。
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull().$type<NotificationType>(),
    level: text("level").notNull().$type<NotificationLevel>(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    ackAt: timestamp("ack_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_read_idx").on(t.userId, t.readAt),
  ],
);

// ============================================================
// 以下三表 P0 只建模型+迁移，不写扇出逻辑：
// 关注者/自动已读/自定义映射属 P1-A 通知增强包；推送 token 注册属 E 阶段。
// ============================================================

/** 任务级关注与通知设置（PLAN.md §5.3/§5.6；P1-A 实现扇出） */
export const taskWatchers = pgTable(
  "task_watchers",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notifyMode: text("notify_mode").notNull().default("all").$type<NotifyMode>(),
    muteOverdue: boolean("mute_overdue").notNull().default(false),
    muteIncomplete: boolean("mute_incomplete").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("task_watchers_task_user_key").on(t.taskId, t.userId)],
);

/** 用户级「类型→等级」自定义映射（PLAN.md §5.2；P1-A 设置页读写） */
export const userNotificationPrefs = pgTable("user_notification_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  typeLevels: jsonb("type_levels")
    .notNull()
    .$type<Partial<Record<NotificationType, NotificationLevel>>>(),
  pushOverrides: jsonb("push_overrides").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** 推送设备 token（E 阶段注册/扇出：Expo Push + web-push） */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    /** expo | webpush */
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("push_tokens_user_token_key").on(t.userId, t.token)],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type ListRow = typeof lists.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type SubtaskRow = typeof subtasks.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type TaskWatcherRow = typeof taskWatchers.$inferSelect;
