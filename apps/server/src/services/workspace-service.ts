import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  COPY,
  INVITE_TTL_DAYS,
  type CreateInviteBody,
  type CreateWorkspaceBody,
  type Invite,
  type InviteInfo,
  type Member,
  type UpdateMemberRoleBody,
  type UpdateWorkspaceBody,
  type Workspace,
  type WorkspaceRole,
} from "@doughpie/shared";
import type { Db, Tx } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import {
  invites,
  memberships,
  tasks,
  users,
  workspaces,
  type InviteRow,
  type MembershipRow,
  type WorkspaceRow,
} from "../models/schema.js";
import { writeEvent } from "./event-service.js";
import { insertNotification } from "./notification-service.js";
import { requireCan, requireMembership } from "./workspace-guard.js";

/**
 * 工作区/成员/邀请业务流（P0-2/P0-5，backend.md §3）。
 * 建区不限量、创建者即 owner；owner 转让是 P1（本轮 member↔viewer 双向可调）。
 * 成员移除/退出：其负责任务自动置 assignee_id=null（PLAN.md §8）。
 */

export interface WorkspaceServiceDeps {
  db: Db;
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;

function toWorkspaceDto(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    owner_id: row.ownerId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toInviteDto(row: InviteRow): Invite {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    code: row.code,
    role: row.role,
    expires_at: row.expiresAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function toMemberDto(row: {
  membership: MembershipRow;
  username: string;
  displayName: string;
}): Member {
  return {
    user_id: row.membership.userId,
    username: row.username,
    display_name: row.displayName,
    role: row.membership.role,
    joined_at: row.membership.joinedAt.toISOString(),
  };
}

/** 邀请码：不透明随机串（base64url 12 字节 → 16 字符，可拼 URL） */
function newInviteCode(): string {
  return randomBytes(12).toString("base64url");
}

/** 校验邀请码可入区：已作废 → INVITE_INVALID；已过期 → INVITE_EXPIRED */
function assertInviteUsable(invite: InviteRow): void {
  if (invite.revokedAt !== null) {
    throw new ApiError(404, "INVITE_INVALID", COPY.workspace.inviteInvalid);
  }
  if (invite.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(410, "INVITE_EXPIRED", COPY.workspace.inviteExpired);
  }
}

/** 成员移除/退出共用：同事务删成员 + 其负责任务置未分配 + 事件 + （可选）当事人通知 */
async function removeMembershipTx(
  tx: Tx,
  input: {
    workspaceId: string;
    workspaceName: string;
    target: MembershipRow;
    actorId: string;
    eventType: "member.left" | "member.removed";
    notifyTarget: boolean;
  },
): Promise<void> {
  await tx.delete(memberships).where(eq(memberships.id, input.target.id));
  // 被移除/退出者负责任务自动置未分配（含已完成任务的历史负责人也清空，保持成员域一致）
  const affected = await tx
    .update(tasks)
    .set({ assigneeId: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(tasks.workspaceId, input.workspaceId),
        eq(tasks.assigneeId, input.target.userId),
        isNull(tasks.deletedAt),
      ),
    )
    .returning({ id: tasks.id });
  await writeEvent(tx, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    type: input.eventType,
    entity: "member",
    entityId: input.target.userId,
    payload: {
      user_id: input.target.userId,
      role: input.target.role,
      // 消费方凭 task_ids 精确失效任务缓存
      task_ids: affected.map((t) => t.id),
    },
  });
  if (input.notifyTarget) {
    // PLAN.md §5.1：移出工作区/角色变更 → system 通知（🟠 中，手动已读）
    await insertNotification(tx, {
      userId: input.target.userId,
      workspaceId: input.workspaceId,
      type: "system",
      entity: "workspace",
      entityId: input.workspaceId,
      actorId: input.actorId,
      payload: { workspace_id: input.workspaceId, workspace_name: input.workspaceName },
    });
  }
}

export function createWorkspaceService(deps: WorkspaceServiceDeps) {
  const { db } = deps;

  /** 载入工作区；不存在 → 404 */
  async function loadWorkspace(workspaceId: string): Promise<WorkspaceRow> {
    const row = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    return row;
  }

  return {
    /** 建区（不限量）：同事务写 workspace + owner membership + workspace.created 事件 */
    async create(userId: string, body: CreateWorkspaceBody): Promise<Workspace> {
      const id = uuidv7();
      return db.transaction(async (tx) => {
        const [ws] = await tx
          .insert(workspaces)
          .values({ id, name: body.name, ownerId: userId })
          .returning();
        if (!ws) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        await tx.insert(memberships).values({
          id: uuidv7(),
          userId,
          workspaceId: id,
          role: "owner",
        });
        await writeEvent(tx, {
          workspaceId: id,
          actorId: userId,
          type: "workspace.created",
          entity: "workspace",
          entityId: id,
          payload: { name: body.name },
        });
        return toWorkspaceDto(ws);
      });
    },

    /** 我的工作区列表（按加入序） */
    async listMine(userId: string): Promise<Workspace[]> {
      const rows = await db
        .select({ workspace: workspaces })
        .from(memberships)
        .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(memberships.joinedAt));
      return rows.map((r) => toWorkspaceDto(r.workspace));
    },

    /** 详情（三角色可读，设置页用）；非成员统一 403（不暴露存在性，guard 约定） */
    async getById(userId: string, workspaceId: string): Promise<Workspace> {
      await requireCan(db, workspaceId, userId, "workspace.read");
      return toWorkspaceDto(await loadWorkspace(workspaceId));
    },

    /** 重命名（仅 owner） */
    async rename(
      userId: string,
      workspaceId: string,
      body: UpdateWorkspaceBody,
    ): Promise<Workspace> {
      await requireCan(db, workspaceId, userId, "workspace.update");
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(workspaces)
          // updatedAt 用 DB 时钟（与 insert 的 defaultNow 同源），避免应用/库双时钟漂移导致比较失真
          .set({ name: body.name, updatedAt: sql`now()` })
          .where(eq(workspaces.id, workspaceId))
          .returning();
        if (rows.length === 0) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        await writeEvent(tx, {
          workspaceId,
          actorId: userId,
          type: "workspace.updated",
          entity: "workspace",
          entityId: workspaceId,
          payload: { name: body.name },
        });
        return rows;
      });
      if (!updated) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      return toWorkspaceDto(updated);
    },

    /** 成员列表（三角色可读；join users 取展示字段） */
    async listMembers(userId: string, workspaceId: string): Promise<Member[]> {
      await requireCan(db, workspaceId, userId, "member.read");
      const rows = await db
        .select({
          membership: memberships,
          username: users.username,
          displayName: users.displayName,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(eq(memberships.workspaceId, workspaceId))
        .orderBy(asc(memberships.joinedAt));
      return rows.map(toMemberDto);
    },

    /**
     * 角色变更 member↔viewer（仅 owner；owner 转让是 P1）。
     * 目标是 owner → 409 LAST_OWNER；角色未变 → 幂等返回（不写事件）。
     */
    async updateMemberRole(
      userId: string,
      workspaceId: string,
      targetUserId: string,
      body: UpdateMemberRoleBody,
    ): Promise<Member> {
      await requireCan(db, workspaceId, userId, "member.role_change");
      const target = await db.query.memberships.findFirst({
        where: and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)),
      });
      if (!target) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      if (target.role === "owner") {
        throw new ApiError(409, "LAST_OWNER", COPY.workspace.lastOwner);
      }

      const loadDto = async (): Promise<Member> => {
        const rows = await db
          .select({
            membership: memberships,
            username: users.username,
            displayName: users.displayName,
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(eq(memberships.id, target.id));
        const row = rows[0];
        if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        return toMemberDto(row);
      };

      if (target.role === body.role) return loadDto(); // 幂等：角色未变不写事件

      await db.transaction(async (tx) => {
        await tx.update(memberships).set({ role: body.role }).where(eq(memberships.id, target.id));
        await writeEvent(tx, {
          workspaceId,
          actorId: userId,
          type: "member.role_changed",
          entity: "member",
          entityId: targetUserId,
          payload: { user_id: targetUserId, from: target.role, to: body.role },
        });
        // 当事人 system 通知（PLAN.md §5.1）
        const ws = await tx.query.workspaces.findFirst({
          where: eq(workspaces.id, workspaceId),
          columns: { name: true },
        });
        await insertNotification(tx, {
          userId: targetUserId,
          workspaceId,
          type: "system",
          entity: "workspace",
          entityId: workspaceId,
          actorId: userId,
          payload: {
            workspace_id: workspaceId,
            workspace_name: ws?.name ?? "",
            from: target.role,
            to: body.role,
          },
        });
      });
      return loadDto();
    },

    /** 移除成员（仅 owner；owner 不可被移除 → 409 LAST_OWNER） */
    async removeMember(userId: string, workspaceId: string, targetUserId: string): Promise<void> {
      await requireCan(db, workspaceId, userId, "member.remove");
      const ws = await loadWorkspace(workspaceId);
      const target = await db.query.memberships.findFirst({
        where: and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, targetUserId)),
      });
      if (!target) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      if (target.role === "owner") {
        throw new ApiError(409, "LAST_OWNER", COPY.workspace.lastOwner);
      }
      await db.transaction(async (tx) => {
        await removeMembershipTx(tx, {
          workspaceId,
          workspaceName: ws.name,
          target,
          actorId: userId,
          eventType: "member.removed",
          notifyTarget: true,
        });
      });
    },

    /** 主动退出（成员退自己；唯一 owner 退出 → 409 LAST_OWNER） */
    async leaveWorkspace(userId: string, workspaceId: string): Promise<void> {
      const self = await requireMembership(db, workspaceId, userId);
      if (self.role === "owner") {
        const others = await db.query.memberships.findMany({
          where: and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.role, "owner"),
            ne(memberships.userId, userId),
          ),
          columns: { id: true },
        });
        if (others.length === 0) {
          throw new ApiError(409, "LAST_OWNER", COPY.workspace.lastOwner);
        }
      }
      const ws = await loadWorkspace(workspaceId);
      await db.transaction(async (tx) => {
        await removeMembershipTx(tx, {
          workspaceId,
          workspaceName: ws.name,
          target: self,
          actorId: userId,
          eventType: "member.left",
          notifyTarget: false, // 主动退出不给自己发通知
        });
      });
    },

    /** 创建邀请链接（owner+member）：7 天有效、不限次数 */
    async createInvite(
      userId: string,
      workspaceId: string,
      body: CreateInviteBody,
    ): Promise<Invite> {
      await requireCan(db, workspaceId, userId, "invite.create");
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
      const [row] = await db
        .insert(invites)
        .values({
          id: uuidv7(),
          workspaceId,
          code: newInviteCode(),
          role: body.role,
          expiresAt,
          createdBy: userId,
        })
        .returning();
      if (!row) throw new ApiError(500, "INTERNAL", COPY.common.internal);
      return toInviteDto(row);
    },

    /** 邀请列表（owner+member；不含已作废） */
    async listInvites(userId: string, workspaceId: string): Promise<Invite[]> {
      await requireCan(db, workspaceId, userId, "invite.read");
      const rows = await db
        .select()
        .from(invites)
        .where(and(eq(invites.workspaceId, workspaceId), isNull(invites.revokedAt)))
        .orderBy(asc(invites.createdAt));
      return rows.map(toInviteDto);
    },

    /** 作废邀请（仅 owner；幂等：已作废直接成功） */
    async revokeInvite(userId: string, workspaceId: string, inviteId: string): Promise<void> {
      await requireCan(db, workspaceId, userId, "invite.revoke");
      const row = await db.query.invites.findFirst({
        where: and(eq(invites.id, inviteId), eq(invites.workspaceId, workspaceId)),
      });
      if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      if (row.revokedAt !== null) return;
      await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, inviteId));
    },

    /** 邀请预览（任何登录用户；失效/过期语义与接受一致） */
    async getInviteInfo(_userId: string, code: string): Promise<InviteInfo> {
      const invite = await db.query.invites.findFirst({ where: eq(invites.code, code) });
      if (!invite) throw new ApiError(404, "INVITE_INVALID", COPY.workspace.inviteInvalid);
      assertInviteUsable(invite);
      const ws = await loadWorkspace(invite.workspaceId);
      return {
        workspace_id: ws.id,
        workspace_name: ws.name,
        role: invite.role,
        expires_at: invite.expiresAt.toISOString(),
      };
    },

    /** 接受邀请入区（按邀请 role 落 membership；已是成员 → 409 ALREADY_MEMBER） */
    async acceptInvite(userId: string, code: string): Promise<Workspace> {
      const invite = await db.query.invites.findFirst({ where: eq(invites.code, code) });
      if (!invite) throw new ApiError(404, "INVITE_INVALID", COPY.workspace.inviteInvalid);
      assertInviteUsable(invite);
      const ws = await loadWorkspace(invite.workspaceId);

      const existing = await db.query.memberships.findFirst({
        where: and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, userId)),
        columns: { id: true },
      });
      if (existing) throw new ApiError(409, "ALREADY_MEMBER", COPY.workspace.alreadyMember);

      const role: WorkspaceRole = invite.role;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(memberships).values({
            id: uuidv7(),
            userId,
            workspaceId: ws.id,
            role,
          });
          await writeEvent(tx, {
            workspaceId: ws.id,
            actorId: userId,
            type: "member.joined",
            entity: "member",
            entityId: userId,
            payload: { user_id: userId, role, via: "invite" },
          });
        });
      } catch (err) {
        // 并发重复接受：唯一索引兜底
        if (isUniqueViolation(err)) {
          throw new ApiError(409, "ALREADY_MEMBER", COPY.workspace.alreadyMember);
        }
        throw err;
      }
      return toWorkspaceDto(ws);
    },
  };
}
