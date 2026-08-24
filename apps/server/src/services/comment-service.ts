import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  COPY,
  type Comment,
  type CommentMention,
  type CommentQuery,
  type CreateCommentBody,
  type CursorPage,
  type UpdateCommentBody,
} from "@doughpie/shared";
import type { Db, Tx } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import {
  comments,
  memberships,
  notifications,
  tasks,
  users,
  type CommentRow,
  type TaskRow,
} from "../models/schema.js";
import { writeEvent } from "./event-service.js";
import { extractMentionNames } from "./mention.js";
import { insertNotification } from "./notification-service.js";
import { requireCan } from "./workspace-guard.js";

/**
 * 讨论区业务流（P0-17，PLAN.md §5.5/§6.1）：
 * - 一级回复（parent 必须是顶层评论，二级嵌套 → 400）；编辑不限期（edited_at 标记）
 * - 删除留 tombstone（deleted=true，DTO content 置空、mentions 清空，回复仍在）
 * - state_at_comment 记录发表时任务状态，永久沉淀
 * - @提及仅工作区成员（§10 防骚扰）；被提及者每人一条 mention 通知（🔴 待确认，永不自动已读）
 * - 确认闭环：ack 在 notification-service；本模块负责 DTO 的 mentions[].acked_at 回显
 */

export interface CommentServiceDeps {
  db: Db;
}

export type CommentService = ReturnType<typeof createCommentService>;

/** 通知深链载荷里的摘要（前 80 字符） */
function excerptOf(content: string): string {
  return content.length > 80 ? `${content.slice(0, 80)}…` : content;
}

/** 评论游标：(created_at ISO, id) 复合键，base64url(JSON)，按发表时间升序 */
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

export function createCommentService(deps: CommentServiceDeps) {
  const { db } = deps;

  async function loadTask(taskId: string): Promise<TaskRow> {
    const row = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
    });
    if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    return row;
  }

  async function loadComment(commentId: string): Promise<CommentRow> {
    const row = await db.query.comments.findFirst({ where: eq(comments.id, commentId) });
    if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    return row;
  }

  /**
   * 解析内容中的 @提及 → 本工作区成员的 user_id 集（去重；排除评论作者本人）。
   * 非成员/不存在的用户名按纯文本处理（不产生提及）。
   */
  async function resolveMentionUserIds(
    workspaceId: string,
    content: string,
    authorId: string,
  ): Promise<string[]> {
    const names = extractMentionNames(content);
    if (names.length === 0) return [];
    const rows = await db
      .select({ userId: memberships.userId, username: users.username })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.workspaceId, workspaceId), inArray(users.username, names)));
    return rows.filter((r) => r.userId !== authorId).map((r) => r.userId);
  }

  /** 事务内为提及者各发一条 mention 通知（🔴 高，确认闭环） */
  async function notifyMentions(
    tx: Tx,
    input: {
      workspaceId: string;
      taskId: string;
      commentId: string;
      authorId: string;
      mentionUserIds: string[];
      content: string;
    },
  ): Promise<void> {
    for (const targetUserId of input.mentionUserIds) {
      // oxlint-disable-next-line no-await-in-loop -- 事务内串行写是有意设计：通知顺序与提交一致
      await insertNotification(tx, {
        userId: targetUserId,
        workspaceId: input.workspaceId,
        type: "mention",
        entity: "comment",
        entityId: input.commentId,
        actorId: input.authorId,
        payload: {
          task_id: input.taskId,
          comment_id: input.commentId,
          excerpt: excerptOf(input.content),
        },
      });
    }
  }

  /**
   * 组装评论 DTO（批量）：作者信息 join users；mentions 的 acked_at 取
   * 该评论关联 mention 通知的最新确认时间（PLAN.md §5.5 闭环展示）。
   */
  async function toCommentDtos(rows: CommentRow[]): Promise<Comment[]> {
    if (rows.length === 0) return [];
    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const authorRows = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, authorIds));
    const authorMap = new Map(authorRows.map((u) => [u.id, u]));

    const mentionUserIds = [...new Set(rows.flatMap((r) => r.mentionUserIds))];
    const mentionUserRows =
      mentionUserIds.length === 0
        ? []
        : await db
            .select({ id: users.id, username: users.username, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, mentionUserIds));
    const mentionUserMap = new Map(mentionUserRows.map((u) => [u.id, u]));

    // 该批评论的 mention 通知 → (comment_id, user_id) → 最新 ack_at
    const commentIds = rows.map((r) => r.id);
    const mentionNotifs = await db
      .select({
        userId: notifications.userId,
        ackAt: notifications.ackAt,
        commentId: sql<string>`${notifications.payload}->>'comment_id'`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "mention"),
          inArray(sql`${notifications.payload}->>'comment_id'`, commentIds),
        ),
      );
    const ackMap = new Map<string, Date>();
    for (const n of mentionNotifs) {
      if (n.ackAt === null) continue;
      const key = `${n.commentId}:${n.userId}`;
      const prev = ackMap.get(key);
      if (!prev || n.ackAt > prev) ackMap.set(key, n.ackAt);
    }

    return rows.map((row) => {
      const author = authorMap.get(row.authorId);
      const deleted = row.deletedAt !== null;
      const mentions: CommentMention[] = deleted
        ? []
        : row.mentionUserIds.map((uid) => {
            const u = mentionUserMap.get(uid);
            return {
              user_id: uid,
              username: u?.username ?? "",
              display_name: u?.displayName ?? "",
              acked_at: ackMap.get(`${row.id}:${uid}`)?.toISOString() ?? null,
            };
          });
      return {
        id: row.id,
        task_id: row.taskId,
        author_id: row.authorId,
        author_username: author?.username ?? "",
        author_display_name: author?.displayName ?? "",
        parent_id: row.parentId,
        // tombstone：content 置空，回复仍在
        content: deleted ? "" : row.content,
        state_at_comment: row.stateAtComment,
        edited_at: row.editedAt?.toISOString() ?? null,
        deleted,
        mentions,
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  return {
    /** 评论时间线（含 tombstone；created_at 升序，键集游标） */
    async listComments(
      userId: string,
      taskId: string,
      query: CommentQuery,
    ): Promise<CursorPage<Comment>> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "comment.read");
      const conditions: SQL[] = [eq(comments.taskId, taskId)];
      // 排序与键集统一按毫秒截断归一（PG 微秒 vs JS 毫秒的精度差会让同毫秒行跨页重复）
      const trunc = sql`date_trunc('milliseconds', ${comments.createdAt})`;
      if (query.cursor !== undefined) {
        const c = decodeCursor(query.cursor);
        // 升序键集（参数传 ISO 串，postgres.js 不序列化 raw Date）
        conditions.push(
          sql`(${trunc} > ${c.createdAt.toISOString()} OR (${trunc} = ${c.createdAt.toISOString()} AND ${comments.id} > ${c.id}))`,
        );
      }
      const rows = await db
        .select()
        .from(comments)
        .where(and(...conditions))
        .orderBy(asc(trunc), asc(comments.id))
        .limit(query.limit + 1);
      const items = rows.slice(0, query.limit);
      const last = items[items.length - 1];
      return {
        items: await toCommentDtos(items),
        next_cursor:
          rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    },

    /**
     * 发表评论：parent 必须是非删除的顶层评论（二级嵌套 → 400）；
     * 记录 state_at_comment；同事务写 mention 通知 + comment.created 事件。
     */
    async createComment(userId: string, taskId: string, body: CreateCommentBody): Promise<Comment> {
      const task = await loadTask(taskId);
      await requireCan(db, task.workspaceId, userId, "comment.write");

      if (body.parent_id !== undefined) {
        const parent = await db.query.comments.findFirst({
          where: and(eq(comments.id, body.parent_id), eq(comments.taskId, taskId)),
        });
        // 一级回复：parent 必须是顶层且未删除
        if (!parent || parent.parentId !== null || parent.deletedAt !== null) {
          throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
        }
      }

      const mentionUserIds = await resolveMentionUserIds(task.workspaceId, body.content, userId);

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(comments)
          .values({
            id: uuidv7(),
            taskId,
            authorId: userId,
            parentId: body.parent_id ?? null,
            content: body.content,
            stateAtComment: task.status,
            mentionUserIds,
          })
          .returning();
        if (!row) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        await notifyMentions(tx, {
          workspaceId: task.workspaceId,
          taskId,
          commentId: row.id,
          authorId: userId,
          mentionUserIds,
          content: body.content,
        });
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "comment.created",
          entity: "comment",
          entityId: row.id,
          payload: {
            task_id: taskId,
            parent_id: row.parentId,
            state_at_comment: row.stateAtComment,
            mention_user_ids: mentionUserIds,
          },
        });
        return row;
      });
      const [dto] = await toCommentDtos([created]);
      if (!dto) throw new ApiError(500, "INTERNAL", COPY.common.internal);
      return dto;
    },

    /**
     * 编辑评论（不限期，仅作者本人）：edited_at 标记；重解析 @提及——
     * 新增提及补发通知，移除的提及不回删历史通知（mention_user_ids 以最新内容为准）。
     */
    async updateComment(
      userId: string,
      commentId: string,
      body: UpdateCommentBody,
    ): Promise<Comment> {
      const comment = await loadComment(commentId);
      if (comment.deletedAt !== null) {
        throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      }
      if (comment.authorId !== userId) {
        throw new ApiError(403, "FORBIDDEN", COPY.common.forbidden);
      }
      const task = await loadTask(comment.taskId);
      await requireCan(db, task.workspaceId, userId, "comment.write");

      const mentionUserIds = await resolveMentionUserIds(task.workspaceId, body.content, userId);
      const addedMentions = mentionUserIds.filter((id) => !comment.mentionUserIds.includes(id));

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(comments)
          .set({ content: body.content, editedAt: new Date(), mentionUserIds })
          .where(eq(comments.id, commentId))
          .returning();
        if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        await notifyMentions(tx, {
          workspaceId: task.workspaceId,
          taskId: task.id,
          commentId,
          authorId: userId,
          mentionUserIds: addedMentions,
          content: body.content,
        });
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "comment.updated",
          entity: "comment",
          entityId: commentId,
          payload: { task_id: task.id, mention_user_ids: mentionUserIds },
        });
        return row;
      });
      const [dto] = await toCommentDtos([updated]);
      if (!dto) throw new ApiError(500, "INTERNAL", COPY.common.internal);
      return dto;
    },

    /** 删除评论（仅作者本人）：留 tombstone，回复仍在 */
    async deleteComment(userId: string, commentId: string): Promise<void> {
      const comment = await loadComment(commentId);
      if (comment.deletedAt !== null) {
        throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      }
      if (comment.authorId !== userId) {
        throw new ApiError(403, "FORBIDDEN", COPY.common.forbidden);
      }
      const task = await loadTask(comment.taskId);
      await requireCan(db, task.workspaceId, userId, "comment.write");
      await db.transaction(async (tx) => {
        await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
        await writeEvent(tx, {
          workspaceId: task.workspaceId,
          actorId: userId,
          type: "comment.deleted",
          entity: "comment",
          entityId: commentId,
          payload: { task_id: task.id },
        });
      });
    },
  };
}
