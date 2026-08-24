import {
  ROUTES,
  acceptInviteBodySchema,
  createInviteBodySchema,
  createWorkspaceBodySchema,
  updateMemberRoleBodySchema,
  updateWorkspaceBodySchema,
  uuidSchema,
} from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { WorkspaceService } from "../services/workspace-service.js";

/**
 * 工作区/成员/邀请路由（薄）：P0-2/P0-5。业务逻辑全在 workspaceService。
 * 权限一律在 service 层校验（backend.md §7）。
 */
const workspaceParamsSchema = z.object({ id: uuidSchema });
const memberParamsSchema = z.object({ id: uuidSchema, userId: uuidSchema });
const inviteParamsSchema = z.object({ id: uuidSchema, inviteId: uuidSchema });
const inviteCodeParamsSchema = z.object({ code: z.string().min(1) });

// 路径模板从 ROUTES 派生，防与客户端漂移
const workspacePath = `${ROUTES.workspaces}/:id`;
const workspaceMembersPath = `${ROUTES.workspaces}/:id/members`;
const workspaceMemberPath = `${ROUTES.workspaces}/:id/members/:userId`;
const workspaceInvitesPath = `${ROUTES.workspaces}/:id/invites`;
const workspaceInvitePath = `${ROUTES.workspaces}/:id/invites/:inviteId`;
const inviteInfoPath = "/invites/:code";

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  deps: { workspaceService: WorkspaceService },
): void {
  const { workspaceService } = deps;
  const auth = [app.authenticate];

  app.post(ROUTES.workspaces, { preHandler: auth }, async (req, reply) => {
    const body = parseBody(createWorkspaceBodySchema, req.body);
    return reply.status(201).send(await workspaceService.create(requireUser(req).id, body));
  });

  app.get(ROUTES.workspaces, { preHandler: auth }, async (req) => {
    return workspaceService.listMine(requireUser(req).id);
  });

  app.patch(workspacePath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(workspaceParamsSchema, req.params);
    const body = parseBody(updateWorkspaceBodySchema, req.body);
    return workspaceService.rename(requireUser(req).id, id, body);
  });

  app.get(workspaceMembersPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(workspaceParamsSchema, req.params);
    return workspaceService.listMembers(requireUser(req).id, id);
  });

  app.patch(workspaceMemberPath, { preHandler: auth }, async (req) => {
    const { id, userId } = parseBody(memberParamsSchema, req.params);
    const body = parseBody(updateMemberRoleBodySchema, req.body);
    return workspaceService.updateMemberRole(requireUser(req).id, id, userId, body);
  });

  // 移除成员（owner 操作他人）与主动退出（操作自己）共用同一端点
  app.delete(workspaceMemberPath, { preHandler: auth }, async (req, reply) => {
    const { id, userId } = parseBody(memberParamsSchema, req.params);
    const selfId = requireUser(req).id;
    if (userId === selfId) {
      await workspaceService.leaveWorkspace(selfId, id);
    } else {
      await workspaceService.removeMember(selfId, id, userId);
    }
    return reply.status(204).send();
  });

  app.post(workspaceInvitesPath, { preHandler: auth }, async (req, reply) => {
    const { id } = parseBody(workspaceParamsSchema, req.params);
    const body = parseBody(createInviteBodySchema, req.body);
    return reply
      .status(201)
      .send(await workspaceService.createInvite(requireUser(req).id, id, body));
  });

  app.get(workspaceInvitesPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(workspaceParamsSchema, req.params);
    return workspaceService.listInvites(requireUser(req).id, id);
  });

  app.delete(workspaceInvitePath, { preHandler: auth }, async (req, reply) => {
    const { id, inviteId } = parseBody(inviteParamsSchema, req.params);
    await workspaceService.revokeInvite(requireUser(req).id, id, inviteId);
    return reply.status(204).send();
  });

  app.get(inviteInfoPath, { preHandler: auth }, async (req) => {
    const { code } = parseBody(inviteCodeParamsSchema, req.params);
    return workspaceService.getInviteInfo(requireUser(req).id, code);
  });

  app.post(ROUTES.inviteAccept, { preHandler: auth }, async (req) => {
    const body = parseBody(acceptInviteBodySchema, req.body);
    return workspaceService.acceptInvite(requireUser(req).id, body.code);
  });
}
