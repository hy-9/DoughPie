import { ROUTES, adminUpdateUserBodySchema, uuidSchema } from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { AdminService } from "../services/admin-service.js";

/**
 * 实例管理路由（P0-16，仅实例 admin）。
 * 审计：admin 写操作打 pino 日志（actor/target/request-id 由 req.log 携带）；
 * 按既定决策不进 events 表（events 是 workspace 域）。
 */
const adminUserParamsSchema = z.object({ id: uuidSchema });
// 路径模板从 ROUTES 派生，防与客户端漂移
const adminUserPath = `${ROUTES.adminUsers}/:id`;
const adminResetPasswordPath = `${ROUTES.adminUsers}/:id/reset-password`;

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { adminService: AdminService },
): void {
  const { adminService } = deps;
  const adminPreHandlers = [app.authenticate, app.requireAdmin];

  app.get(ROUTES.adminUsers, { preHandler: adminPreHandlers }, async () => {
    return adminService.listUsers();
  });

  app.patch(adminUserPath, { preHandler: adminPreHandlers }, async (req) => {
    const { id } = parseBody(adminUserParamsSchema, req.params);
    const body = parseBody(adminUpdateUserBodySchema, req.body);
    const updated = await adminService.updateUser(requireUser(req).id, id, body);
    req.log.info(
      {
        audit: true,
        actor: requireUser(req).id,
        target: id,
        action: "admin.user.update",
        payload: body,
      },
      "审计：管理员更新用户",
    );
    return updated;
  });

  app.post(adminResetPasswordPath, { preHandler: adminPreHandlers }, async (req) => {
    const { id } = parseBody(adminUserParamsSchema, req.params);
    const result = await adminService.resetPassword(requireUser(req).id, id);
    req.log.info(
      { audit: true, actor: requireUser(req).id, target: id, action: "admin.user.reset_password" },
      "审计：管理员重置用户密码",
    );
    return result;
  });
}
