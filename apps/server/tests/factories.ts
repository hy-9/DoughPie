import { v7 as uuidv7 } from "uuid";
import { hash } from "@node-rs/argon2";
import type {
  InstanceRole,
  Priority,
  RecurrenceRule,
  TaskStatus,
  UserStatus,
  WorkspaceRole,
} from "@doughpie/shared";
import type { Db } from "../src/db.js";
import {
  comments,
  invites,
  lists,
  memberships,
  tasks,
  userIdentities,
  users,
  type CommentRow,
  type InviteRow,
  type ListRow,
  type MembershipRow,
  type TaskRow,
  type UserRow,
  type WorkspaceRow,
  workspaces,
} from "../src/models/schema.js";

/** 测试数据工厂（conventions.md §5.2）：禁止共享可变 fixture，每个用例现建。 */

let seq = 0;

export async function insertUser(
  db: Db,
  overrides?: {
    username?: string;
    password?: string;
    displayName?: string;
    status?: UserStatus;
    role?: InstanceRole;
  },
): Promise<UserRow> {
  seq += 1;
  const username = overrides?.username ?? `user_${seq}`;
  const [row] = await db
    .insert(users)
    .values({
      id: uuidv7(),
      username,
      passwordHash: overrides?.password ? await hash(overrides.password) : null,
      displayName: overrides?.displayName ?? username,
      status: overrides?.status ?? "active",
      role: overrides?.role ?? "user",
    })
    .returning();
  if (!row) throw new Error("insertUser 失败");
  return row;
}

export async function insertUcIdentity(
  db: Db,
  userId: string,
  providerUserId: string,
): Promise<void> {
  await db.insert(userIdentities).values({
    id: uuidv7(),
    userId,
    provider: "uc",
    providerUserId,
  });
}

/** 建工作区（含 owner membership；直插库绕过 service，仅用于测试搭建，不写 events） */
export async function insertWorkspace(
  db: Db,
  owner: UserRow,
  name?: string,
): Promise<WorkspaceRow> {
  seq += 1;
  const id = uuidv7();
  const [row] = await db
    .insert(workspaces)
    .values({ id, name: name ?? `工作区_${seq}`, ownerId: owner.id })
    .returning();
  if (!row) throw new Error("insertWorkspace 失败");
  await db
    .insert(memberships)
    .values({ id: uuidv7(), userId: owner.id, workspaceId: id, role: "owner" });
  return row;
}

export async function insertMembership(
  db: Db,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<MembershipRow> {
  const [row] = await db
    .insert(memberships)
    .values({ id: uuidv7(), workspaceId, userId, role })
    .returning();
  if (!row) throw new Error("insertMembership 失败");
  return row;
}

export async function insertList(
  db: Db,
  workspaceId: string,
  overrides?: { name?: string; color?: string | null; sortOrder?: number },
): Promise<ListRow> {
  seq += 1;
  const [row] = await db
    .insert(lists)
    .values({
      id: uuidv7(),
      workspaceId,
      name: overrides?.name ?? `清单_${seq}`,
      color: overrides?.color ?? null,
      sortOrder: overrides?.sortOrder ?? seq * 1000,
    })
    .returning();
  if (!row) throw new Error("insertList 失败");
  return row;
}

export async function insertTask(
  db: Db,
  input: {
    workspaceId: string;
    listId: string;
    createdBy: string;
    title?: string;
    description?: string | null;
    assigneeId?: string | null;
    status?: TaskStatus;
    priority?: Priority;
    startAt?: Date | null;
    dueAt?: Date | null;
    remindAt?: Date | null;
    recurrence?: RecurrenceRule | null;
    recurrenceSpawned?: boolean;
    sortOrder?: number;
    completedAt?: Date | null;
    completedBy?: string | null;
    deletedAt?: Date | null;
  },
): Promise<TaskRow> {
  seq += 1;
  const [row] = await db
    .insert(tasks)
    .values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      listId: input.listId,
      title: input.title ?? `任务_${seq}`,
      description: input.description ?? null,
      assigneeId: input.assigneeId ?? null,
      status: input.status ?? "todo",
      priority: input.priority ?? "none",
      startAt: input.startAt ?? null,
      dueAt: input.dueAt ?? null,
      remindAt: input.remindAt ?? null,
      recurrence: input.recurrence ?? null,
      recurrenceSpawned: input.recurrenceSpawned ?? false,
      sortOrder: input.sortOrder ?? seq * 1000,
      completedAt: input.completedAt ?? null,
      completedBy: input.completedBy ?? null,
      deletedAt: input.deletedAt ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error("insertTask 失败");
  return row;
}

export async function insertComment(
  db: Db,
  input: {
    taskId: string;
    authorId: string;
    content?: string;
    parentId?: string | null;
    stateAtComment?: TaskStatus;
    mentionUserIds?: string[];
    deletedAt?: Date | null;
  },
): Promise<CommentRow> {
  seq += 1;
  const [row] = await db
    .insert(comments)
    .values({
      id: uuidv7(),
      taskId: input.taskId,
      authorId: input.authorId,
      parentId: input.parentId ?? null,
      content: input.content ?? `评论_${seq}`,
      stateAtComment: input.stateAtComment ?? "todo",
      mentionUserIds: input.mentionUserIds ?? [],
      deletedAt: input.deletedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("insertComment 失败");
  return row;
}

export async function insertInvite(
  db: Db,
  input: {
    workspaceId: string;
    createdBy: string;
    role?: "member" | "viewer";
    code?: string;
    expiresAt?: Date;
    revokedAt?: Date | null;
  },
): Promise<InviteRow> {
  seq += 1;
  const [row] = await db
    .insert(invites)
    .values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      code: input.code ?? `invite-code-${seq}`,
      role: input.role ?? "member",
      expiresAt: input.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      revokedAt: input.revokedAt ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error("insertInvite 失败");
  return row;
}
