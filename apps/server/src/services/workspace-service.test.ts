import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { events, memberships, notifications, tasks } from "../models/schema.js";
import { createWorkspaceService, type WorkspaceService } from "./workspace-service.js";
import {
  insertInvite,
  insertList,
  insertMembership,
  insertTask,
  insertUser,
  insertWorkspace,
} from "../../tests/factories.js";
import { createTestDb, truncateAll } from "../../tests/helpers.js";

/**
 * L2 工作区/成员/邀请业务流（P0-2/P0-5）。
 * 断言从规格推导：建区即 owner、member↔viewer 角色变更、移除/退出置空任务、
 * 邀请 7 天/作废/过期/重复入区；所有业务写同事务落 events（AGENTS.md 关键约束）。
 */

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ statusCode: status, code });
}

describe("工作区/成员/邀请服务（L2）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let svc: WorkspaceService;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
    svc = createWorkspaceService({ db });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("建区：创建者即 owner（membership 落库），同事务写 workspace.created 事件", async () => {
    const owner = await insertUser(db);
    const ws = await svc.create(owner.id, { name: "研发部" });
    expect(ws.name).toBe("研发部");
    expect(ws.owner_id).toBe(owner.id);

    const my = await svc.listMine(owner.id);
    expect(my.map((w) => w.id)).toEqual([ws.id]);

    const memberRows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, ws.id), eq(memberships.userId, owner.id)));
    expect(memberRows[0]?.role).toBe("owner");

    const evRows = await db.select().from(events).where(eq(events.workspaceId, ws.id));
    expect(evRows).toHaveLength(1);
    expect(evRows[0]?.type).toBe("workspace.created");
    expect(evRows[0]?.payload).toEqual({ name: "研发部" });
  });

  it("重命名：owner 可改并写 workspace.updated；member/viewer → 403", async () => {
    const owner = await insertUser(db);
    const member = await insertUser(db);
    const viewer = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, member.id, "member");
    await insertMembership(db, ws.id, viewer.id, "viewer");

    const renamed = await svc.rename(owner.id, ws.id, { name: "新名字" });
    expect(renamed.name).toBe("新名字");
    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "workspace.updated")));
    expect(evRows).toHaveLength(1);

    await expectApiError(svc.rename(member.id, ws.id, { name: "x" }), 403, "FORBIDDEN");
    await expectApiError(svc.rename(viewer.id, ws.id, { name: "x" }), 403, "FORBIDDEN");
    // 非成员同样 403
    const outsider = await insertUser(db);
    await expectApiError(svc.rename(outsider.id, ws.id, { name: "x" }), 403, "FORBIDDEN");
  });

  it("成员列表：join users 返回 username/display_name/role/joined_at", async () => {
    const owner = await insertUser(db, { username: "owner1", displayName: "老大" });
    const viewer = await insertUser(db, { username: "viewer1" });
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, viewer.id, "viewer");

    const members = await svc.listMembers(viewer.id, ws.id); // viewer 也可读成员列表
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({
      user_id: owner.id,
      username: "owner1",
      display_name: "老大",
      role: "owner",
    });
    expect(members[1]).toMatchObject({ user_id: viewer.id, role: "viewer" });
  });

  it("角色变更 member→viewer：写 member.role_changed 事件 + 给当事人发 system 通知", async () => {
    const owner = await insertUser(db);
    const member = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, member.id, "member");

    const updated = await svc.updateMemberRole(owner.id, ws.id, member.id, { role: "viewer" });
    expect(updated.role).toBe("viewer");

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "member.role_changed")));
    expect(evRows).toHaveLength(1);
    expect(evRows[0]?.payload).toMatchObject({ user_id: member.id, from: "member", to: "viewer" });

    const ntfs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, member.id), eq(notifications.type, "system")));
    expect(ntfs).toHaveLength(1);
    expect(ntfs[0]?.level).toBe("mid");
    expect(ntfs[0]?.payload).toMatchObject({ workspace_id: ws.id, from: "member", to: "viewer" });

    // 幂等：角色未变不写事件不发通知
    await svc.updateMemberRole(owner.id, ws.id, member.id, { role: "viewer" });
    const evAfter = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "member.role_changed")));
    expect(evAfter).toHaveLength(1);
  });

  it("角色变更：目标是 owner → 409 LAST_OWNER；非 owner 操作 → 403", async () => {
    const owner = await insertUser(db);
    const member = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, member.id, "member");

    await expectApiError(
      svc.updateMemberRole(owner.id, ws.id, owner.id, { role: "member" }),
      409,
      "LAST_OWNER",
    );
    await expectApiError(
      svc.updateMemberRole(member.id, ws.id, member.id, { role: "viewer" }),
      403,
      "FORBIDDEN",
    );
    await expectApiError(
      svc.updateMemberRole(owner.id, ws.id, crypto.randomUUID(), { role: "viewer" }),
      404,
      "NOT_FOUND",
    );
  });

  it("移除成员：membership 删除 + 其负责任务置未分配 + member.removed 事件 + system 通知", async () => {
    const owner = await insertUser(db);
    const member = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, member.id, "member");
    const list = await insertList(db, ws.id);
    const t1 = await insertTask(db, {
      workspaceId: ws.id,
      listId: list.id,
      createdBy: owner.id,
      assigneeId: member.id,
    });
    const t2 = await insertTask(db, {
      workspaceId: ws.id,
      listId: list.id,
      createdBy: owner.id,
      assigneeId: owner.id,
    });

    await svc.removeMember(owner.id, ws.id, member.id);

    const remaining = await svc.listMembers(owner.id, ws.id);
    expect(remaining).toHaveLength(1);

    const t1After = await db.query.tasks.findFirst({ where: eq(tasks.id, t1.id) });
    const t2After = await db.query.tasks.findFirst({ where: eq(tasks.id, t2.id) });
    expect(t1After?.assigneeId).toBeNull();
    expect(t2After?.assigneeId).toBe(owner.id);

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "member.removed")));
    expect(evRows).toHaveLength(1);
    expect(evRows[0]?.payload).toMatchObject({ user_id: member.id, task_ids: [t1.id] });

    const ntfs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, member.id), eq(notifications.type, "system")));
    expect(ntfs).toHaveLength(1);
    expect(ntfs[0]?.payload).toMatchObject({ workspace_id: ws.id });
  });

  it("移除成员：移除 owner → 409 LAST_OWNER；member 无权限 → 403", async () => {
    const owner = await insertUser(db);
    const member = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, member.id, "member");

    await expectApiError(svc.removeMember(owner.id, ws.id, owner.id), 409, "LAST_OWNER");
    await expectApiError(svc.removeMember(member.id, ws.id, owner.id), 403, "FORBIDDEN");
    await expectApiError(svc.removeMember(owner.id, ws.id, crypto.randomUUID()), 404, "NOT_FOUND");
  });

  it("主动退出：member 成功（member.left + 任务置空 + 无通知）；唯一 owner 退出 → 409", async () => {
    const owner = await insertUser(db);
    const member = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, member.id, "member");

    await svc.leaveWorkspace(member.id, ws.id);
    expect(await svc.listMine(member.id)).toHaveLength(0);

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "member.left")));
    expect(evRows).toHaveLength(1);
    // 主动退出不给当事人发通知
    const ntfs = await db.select().from(notifications).where(eq(notifications.userId, member.id));
    expect(ntfs).toHaveLength(0);

    await expectApiError(svc.leaveWorkspace(owner.id, ws.id), 409, "LAST_OWNER");
  });

  it("邀请：创建（默认 member/显式 viewer，7 天有效）；列表不含已作废；作废幂等", async () => {
    const owner = await insertUser(db);
    const ws = await insertWorkspace(db, owner);

    const inv1 = await svc.createInvite(owner.id, ws.id, { role: "member" });
    expect(inv1.role).toBe("member");
    const ttlMs = new Date(inv1.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(6 * 24 * 3600 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);

    const inv2 = await svc.createInvite(owner.id, ws.id, { role: "viewer" });
    expect(inv2.role).toBe("viewer");

    expect(await svc.listInvites(owner.id, ws.id)).toHaveLength(2);
    await svc.revokeInvite(owner.id, ws.id, inv2.id);
    await svc.revokeInvite(owner.id, ws.id, inv2.id); // 幂等
    const after = await svc.listInvites(owner.id, ws.id);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(inv1.id);
  });

  it("邀请权限：member 可创建/查看但不可作废；viewer 全不行", async () => {
    const owner = await insertUser(db);
    const member = await insertUser(db);
    const viewer = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, member.id, "member");
    await insertMembership(db, ws.id, viewer.id, "viewer");

    const inv = await svc.createInvite(member.id, ws.id, { role: "member" });
    expect(await svc.listInvites(member.id, ws.id)).toHaveLength(1);
    await expectApiError(svc.revokeInvite(member.id, ws.id, inv.id), 403, "FORBIDDEN");
    await expectApiError(svc.createInvite(viewer.id, ws.id, { role: "member" }), 403, "FORBIDDEN");
    await expectApiError(svc.listInvites(viewer.id, ws.id), 403, "FORBIDDEN");
  });

  it("邀请预览：正常返回 InviteInfo；作废 → 404 INVITE_INVALID；过期 → 410 INVITE_EXPIRED", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const ws = await insertWorkspace(db, owner, "预览区");
    const inv = await svc.createInvite(owner.id, ws.id, { role: "viewer" });

    const info = await svc.getInviteInfo(guest.id, inv.code);
    expect(info).toMatchObject({ workspace_id: ws.id, workspace_name: "预览区", role: "viewer" });

    await svc.revokeInvite(owner.id, ws.id, inv.id);
    await expectApiError(svc.getInviteInfo(guest.id, inv.code), 404, "INVITE_INVALID");

    const expired = await insertInvite(db, {
      workspaceId: ws.id,
      createdBy: owner.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expectApiError(svc.getInviteInfo(guest.id, expired.code), 410, "INVITE_EXPIRED");
    await expectApiError(svc.getInviteInfo(guest.id, "no-such-code"), 404, "INVITE_INVALID");
  });

  it("接受邀请：按邀请 role 入区 + member.joined 事件；重复入区 → 409 ALREADY_MEMBER", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    const inv = await svc.createInvite(owner.id, ws.id, { role: "viewer" });

    const joined = await svc.acceptInvite(guest.id, inv.code);
    expect(joined.id).toBe(ws.id);
    const members = await svc.listMembers(owner.id, ws.id);
    expect(members.find((m) => m.user_id === guest.id)?.role).toBe("viewer");

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "member.joined")));
    expect(evRows).toHaveLength(1);
    expect(evRows[0]?.payload).toMatchObject({ user_id: guest.id, role: "viewer" });

    await expectApiError(svc.acceptInvite(guest.id, inv.code), 409, "ALREADY_MEMBER");
  });

  it("接受邀请：过期 → 410 INVITE_EXPIRED；作废 → 404 INVITE_INVALID；owner 重复入区 → 409", async () => {
    const owner = await insertUser(db);
    const guest = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    const expired = await insertInvite(db, {
      workspaceId: ws.id,
      createdBy: owner.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expectApiError(svc.acceptInvite(guest.id, expired.code), 410, "INVITE_EXPIRED");

    const revoked = await insertInvite(db, {
      workspaceId: ws.id,
      createdBy: owner.id,
      revokedAt: new Date(),
    });
    await expectApiError(svc.acceptInvite(guest.id, revoked.code), 404, "INVITE_INVALID");

    const fresh = await svc.createInvite(owner.id, ws.id, { role: "member" });
    await expectApiError(svc.acceptInvite(owner.id, fresh.code), 409, "ALREADY_MEMBER");
  });
});
