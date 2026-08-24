// 注意：只能 import type（编译期擦除）。drizzle-kit 以 CJS require 加载本文件，
// 而 @doughpie/shared 是 ESM-only 包，运行时导入会导致 ERR_PACKAGE_PATH_NOT_EXPORTED。
import type { InstanceRole, UserStatus } from "@doughpie/shared";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
