import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  API_PREFIX,
  inviteInfoSchema,
  inviteSchema,
  memberSchema,
  workspaceSchema,
} from "@doughpie/shared";
import type { Db } from "../db.js";
import {
  authHeader,
  buildTestApp,
  createTestDb,
  registerTestUser,
  truncateAll,
} from "../../tests/helpers.js";

/**
 * L3 工作区/成员/邀请路由集成测试（app.inject + 真实测试 PG）。
 * 覆盖：建区/列表/重命名/成员管理/邀请全链路 + 401/403/409 权限抽查。
 */
describe("工作区与邀请路由（L3）", () => {
  let app: FastifyInstance;
  let db: Db;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    app = await buildTestApp();
    ({ db, close: closeDb } = createTestDb());
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it("建区 → 我的区列表 → 重命名 → 成员列表（契约形状校验）", async () => {
    const alice = await registerTestUser(app, "alice");

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "产品组" },
    });
    expect(created.statusCode).toBe(201);
    expect(workspaceSchema.safeParse(created.json()).success).toBe(true);
    const wsId = created.json().id;

    const mine = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().map((w: { id: string }) => w.id)).toEqual([wsId]);

    const renamed = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/workspaces/${wsId}`,
      headers: authHeader(alice.accessToken),
      payload: { name: "产品一组" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("产品一组");

    const members = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/members`,
      headers: authHeader(alice.accessToken),
    });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toHaveLength(1);
    expect(memberSchema.safeParse(members.json()[0]).success).toBe(true);
    expect(members.json()[0].role).toBe("owner");
  });

  it("详情：成员可读（契约形状）；非成员 → 403；未认证 → 401", async () => {
    const alice = await registerTestUser(app, "alice");
    const bob = await registerTestUser(app, "bob");

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "详情区" },
    });
    const wsId = created.json().id as string;

    const detail = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(workspaceSchema.safeParse(detail.json()).success).toBe(true);
    expect(detail.json()).toMatchObject({ id: wsId, name: "详情区" });

    const outsider = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}`,
      headers: authHeader(bob.accessToken),
    });
    expect(outsider.statusCode).toBe(403);

    const anonymous = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("未认证 → 401；空名 → 400", async () => {
    const anonymous = await app.inject({ method: "GET", url: `${API_PREFIX}/workspaces` });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe("UNAUTHORIZED");

    const alice = await registerTestUser(app, "alice");
    const bad = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("VALIDATION_FAILED");
  });

  it("邀请全链路：创建 → 预览 → 接受入区 → 重复接受 409；member 可建 viewer 不可", async () => {
    const alice = await registerTestUser(app, "alice");
    const bob = await registerTestUser(app, "bob");
    const carol = await registerTestUser(app, "carol");

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "邀请区" },
    });
    const wsId = created.json().id;

    const invite = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(alice.accessToken),
      payload: { role: "viewer" },
    });
    expect(invite.statusCode).toBe(201);
    expect(inviteSchema.safeParse(invite.json()).success).toBe(true);
    const code = invite.json().code as string;

    // 预览
    const preview = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/invites/${code}`,
      headers: authHeader(bob.accessToken),
    });
    expect(preview.statusCode).toBe(200);
    expect(inviteInfoSchema.safeParse(preview.json()).success).toBe(true);
    expect(preview.json()).toMatchObject({ workspace_name: "邀请区", role: "viewer" });

    // 接受 → 入区为 viewer
    const accept = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().id).toBe(wsId);

    // 重复接受 → 409 ALREADY_MEMBER
    const again = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("ALREADY_MEMBER");

    // bob(viewer) 建邀请 → 403；列表 → 403
    const bobCreate = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(bob.accessToken),
      payload: { role: "member" },
    });
    expect(bobCreate.statusCode).toBe(403);
    const bobList = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(bob.accessToken),
    });
    expect(bobList.statusCode).toBe(403);

    // 非成员 carol 访问成员列表 → 403
    const outsider = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/members`,
      headers: authHeader(carol.accessToken),
    });
    expect(outsider.statusCode).toBe(403);

    // 乱码邀请 → 404 INVITE_INVALID
    const bad = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/invites/no-such-code`,
      headers: authHeader(carol.accessToken),
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().code).toBe("INVITE_INVALID");
  });

  it("角色变更与成员移除/退出：owner 管理；LAST_OWNER；被移除者失去访问", async () => {
    const alice = await registerTestUser(app, "alice");
    const bob = await registerTestUser(app, "bob");

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "管理区" },
    });
    const wsId = created.json().id;
    const invite = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(alice.accessToken),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code: invite.json().code },
    });

    // bob(member) 试图改自己角色 → 403
    const selfChange = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/workspaces/${wsId}/members/${bob.userId}`,
      headers: authHeader(bob.accessToken),
      payload: { role: "viewer" },
    });
    expect(selfChange.statusCode).toBe(403);

    // owner 改 bob 为 viewer → 200
    const change = await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/workspaces/${wsId}/members/${bob.userId}`,
      headers: authHeader(alice.accessToken),
      payload: { role: "viewer" },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().role).toBe("viewer");

    // owner 移除 bob → 204；bob 不再可见该区
    const removed = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/workspaces/${wsId}/members/${bob.userId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(removed.statusCode).toBe(204);
    const bobMembers = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces/${wsId}/members`,
      headers: authHeader(bob.accessToken),
    });
    expect(bobMembers.statusCode).toBe(403);

    // owner 退出自己（唯一 owner）→ 409 LAST_OWNER
    const ownerLeave = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/workspaces/${wsId}/members/${alice.userId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(ownerLeave.statusCode).toBe(409);
    expect(ownerLeave.json().code).toBe("LAST_OWNER");
  });

  it("成员主动退出 → 204；作废邀请后接受 → 404 INVITE_INVALID", async () => {
    const alice = await registerTestUser(app, "alice");
    const bob = await registerTestUser(app, "bob");

    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(alice.accessToken),
      payload: { name: "退出区" },
    });
    const wsId = created.json().id;
    const invite = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/workspaces/${wsId}/invites`,
      headers: authHeader(alice.accessToken),
      payload: {},
    });
    const code = invite.json().code as string;
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code },
    });

    // bob 主动退出
    const leave = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/workspaces/${wsId}/members/${bob.userId}`,
      headers: authHeader(bob.accessToken),
    });
    expect(leave.statusCode).toBe(204);
    const bobMine = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/workspaces`,
      headers: authHeader(bob.accessToken),
    });
    expect(bobMine.json()).toHaveLength(0);

    // 作废后接受 → 404
    const revoke = await app.inject({
      method: "DELETE",
      url: `${API_PREFIX}/workspaces/${wsId}/invites/${invite.json().id}`,
      headers: authHeader(alice.accessToken),
    });
    expect(revoke.statusCode).toBe(204);
    const acceptRevoked = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invites/accept`,
      headers: authHeader(bob.accessToken),
      payload: { code },
    });
    expect(acceptRevoked.statusCode).toBe(404);
    expect(acceptRevoked.json().code).toBe("INVITE_INVALID");
  });
});
