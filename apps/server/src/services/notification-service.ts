import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  COPY,
  DEFAULT_NOTIFICATION_RULES,
  type CursorPage,
  type Notification,
  type NotificationQuery,
  type NotificationType,
} from "@doughpie/shared";
import type { Db, Tx } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { notifications, tasks, type NotificationRow } from "../models/schema.js";
import { writeEvent } from "./event-service.js";
import { requireCan } from "./workspace-guard.js";

/**
 * 通知（PLAN.md §5）。本轮扇出范围：mention / assigned / system 三类，
 * 与业务写同事务直接插 notifications（insertNotification）。
 * 关注者扇出 / 自动已读 / 自定义等级映射 → P1-A；推送通道 → E 阶段。
 */

export interface InsertNotificationInput {
  userId: string;
  workspaceId: string;
  type: NotificationType;
  /** 关联实体（深链用）：task / comment / workspace */
  entity: string;
  entityId: string;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * 同事务写一条通知。等级取 DEFAULT_NOTIFICATION_RULES 默认映射
 * （用户自定义映射属 P1-A，届时在此读 user_notification_prefs.type_levels）。
 */
export async function insertNotification(tx: Tx, input: InsertNotificationInput): Promise<void> {
  await tx.insert(notifications).values({
    id: uuidv7(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    type: input.type,
    level: DEFAULT_NOTIFICATION_RULES[input.type].level,
    entity: input.entity,
    entityId: input.entityId,
    actorId: input.actorId ?? null,
    payload: input.payload ?? {},
  });
}

/** NotificationRow → 对外 DTO（时间统一 ISO 字符串） */
export function toNotificationDto(row: NotificationRow): Notification {
  return {
    id: row.id,
    user_id: row.userId,
    workspace_id: row.workspaceId,
    type: row.type,
    level: row.level,
    entity: row.entity,
    entity_id: row.entityId,
    actor_id: row.actorId,
    payload: row.payload,
    read_at: row.readAt?.toISOString() ?? null,
    ack_at: row.ackAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * 通知游标编码：(created_at ISO, id) 复合键，base64url(JSON)。
 * 通知中心按 created_at 倒序；同刻毫秒并发用 id 决胜，保证不漏不重。
 * 注意：PG timestamptz 存微秒而 JS Date 只到毫秒——排序与键集比较统一用
 * date_trunc('milliseconds', created_at) 归一，否则同毫秒的行会跨页重复/丢失。
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      const createdAt = new Date(parsed[0]);
      if (!Number.isNaN(createdAt.getTime())) return { createdAt, id: parsed[1] };
    }
  } catch {
    // 落入统一 400
  }
  throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
}

export interface NotificationServiceDeps {
  db: Db;
}

export type NotificationService = ReturnType<typeof createNotificationService>;

const REMIND_THROTTLE_MS = 24 * 3600 * 1000;

export function createNotificationService(deps: NotificationServiceDeps) {
  const { db } = deps;

  return {
    /** 通知中心列表（仅本人的通知；unread_only/level/type 过滤；created_at 倒序游标分页） */
    async listNotifications(
      userId: string,
      query: NotificationQuery,
    ): Promise<CursorPage<Notification>> {
      const conditions: SQL[] = [eq(notifications.userId, userId)];
      if (query.unread_only === true) conditions.push(isNull(notifications.readAt));
      if (query.level !== undefined) conditions.push(eq(notifications.level, query.level));
      if (query.type !== undefined) conditions.push(eq(notifications.type, query.type));
      if (query.cursor !== undefined) {
        const c = decodeCursor(query.cursor);
        // 倒序键集：截断毫秒后的 created_at 更小，或同刻 id 更小（参数传 ISO 串，
        // postgres.js 不序列化 raw Date；截断归一防微秒精度差导致跨页重复）
        const trunc = sql`date_trunc('milliseconds', ${notifications.createdAt})`;
        conditions.push(
          sql`(${trunc} < ${c.createdAt.toISOString()} OR (${trunc} = ${c.createdAt.toISOString()} AND ${notifications.id} < ${c.id}))`,
        );
      }
      const orderTrunc = sql`date_trunc('milliseconds', ${notifications.createdAt})`;
      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(orderTrunc), desc(notifications.id))
        .limit(query.limit + 1);
      const items = rows.slice(0, query.limit);
      const last = items[items.length - 1];
      return {
        items: items.map(toNotificationDto),
        next_cursor:
          rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    },

    /** 手动已读（仅属主；已读的幂等跳过）。无读回需求，路由层返回 204 */
    async markRead(userId: string, ids: string[]): Promise<void> {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            inArray(notifications.id, ids),
            isNull(notifications.readAt),
          ),
        );
    },

    /**
     * 提及确认（PLAN.md §5.5 闭环）：仅 mention 类型、仅通知属主；
     * 置 read_at + ack_at（幂等），同事务写 mention.acked 事件（动态流可见「确认了提及」）。
     */
    async ack(userId: string, notificationId: string): Promise<Notification> {
      const row = await db.query.notifications.findFirst({
        where: eq(notifications.id, notificationId),
      });
      // 他人的通知一律 404（不暴露存在性）
      if (!row || row.userId !== userId) {
        throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      }
      if (row.type !== "mention") {
        // 仅 mention 需要确认闭环；其他类型走手动已读
        throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
      }
      if (row.ackAt !== null) return toNotificationDto(row); // 幂等：重复确认直接返回

      const now = new Date();
      const updatedRows = await db.transaction(async (tx) => {
        const rows = await tx
          .update(notifications)
          .set({ readAt: now, ackAt: now })
          .where(eq(notifications.id, row.id))
          .returning();
        await writeEvent(tx, {
          workspaceId: row.workspaceId,
          actorId: userId,
          type: "mention.acked",
          entity: "notification",
          entityId: row.id,
          payload: {
            task_id: row.payload["task_id"] ?? null,
            comment_id: row.payload["comment_id"] ?? null,
            user_id: userId,
          },
        });
        return rows;
      });
      const confirmed = updatedRows[0];
      if (!confirmed) throw new ApiError(500, "INTERNAL", COPY.common.internal);
      return toNotificationDto(confirmed);
    },

    /**
     * 提及「再提醒」（PLAN.md §5.5：同一发起人对同一提及 24h 限一次，不阻塞流程）。
     * 校验链：任务存在 → 发起人是工作区可写成员 → 存在发起人对该 user 的未确认提及
     * → 24h 节流（查 events 表 mention.reminded）→ 同事务写事件 + 新发 mention 通知。
     */
    async remindMention(actorId: string, taskId: string, targetUserId: string): Promise<void> {
      const task = await db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
      });
      if (!task) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      await requireCan(db, task.workspaceId, actorId, "comment.write");

      // 该任务下发起人对此用户的最新一条未确认提及
      const pending = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, targetUserId),
            eq(notifications.type, "mention"),
            isNull(notifications.ackAt),
            sql`${notifications.payload}->>'task_id' = ${taskId}`,
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(1);
      const pendingRow = pending[0];
      if (!pendingRow) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      // 仅提及发起人可以再提醒（防他人代刷）
      if (pendingRow.actorId !== actorId) {
        throw new ApiError(403, "FORBIDDEN", COPY.common.forbidden);
      }

      // 24h 节流：events 表查同 actor 对同 user 同 task 的 mention.reminded
      const sinceIso = new Date(Date.now() - REMIND_THROTTLE_MS).toISOString();
      const recent = await db.execute<{ id: string }>(
        sql`SELECT id FROM events
            WHERE workspace_id = ${task.workspaceId}
              AND type = 'mention.reminded'
              AND actor_id = ${actorId}
              AND payload->>'task_id' = ${taskId}
              AND payload->>'user_id' = ${targetUserId}
              AND created_at > ${sinceIso}
            LIMIT 1`,
      );
      if (recent.length > 0) {
        // 24h 节流（契约错误码 REMIND_THROTTLED，HTTP 429）
        throw new ApiError(429, "REMIND_THROTTLED", COPY.mention.remindThrottled);
      }

      const commentId =
        typeof pendingRow.payload["comment_id"] === "string"
          ? (pendingRow.payload["comment_id"] as string)
          : null;
      await db.transaction(async (tx) => {
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId,
          type: "mention.reminded",
          entity: "task",
          entityId: taskId,
          payload: { task_id: taskId, user_id: targetUserId, comment_id: commentId },
        });
        await insertNotification(tx, {
          userId: targetUserId,
          workspaceId: task.workspaceId,
          type: "mention",
          entity: "comment",
          entityId: commentId ?? pendingRow.entityId,
          actorId,
          payload: {
            task_id: taskId,
            comment_id: commentId,
            excerpt: pendingRow.payload["excerpt"] ?? "",
            reminded: true,
          },
        });
      });
    },
  };
}
