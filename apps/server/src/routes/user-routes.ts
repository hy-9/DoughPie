import { ROUTES, changePasswordBodySchema, updateMeBodySchema } from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { SsoService } from "../services/sso-service.js";

/** 当前用户路由：资料 / 改密（全端下线）/ 解绑 UC 身份 */
export function registerUserRoutes(
  app: FastifyInstance,
  deps: { authService: AuthService; ssoService: SsoService },
): void {
  const { authService, ssoService } = deps;

  app.get(ROUTES.usersMe, { preHandler: [app.authenticate] }, async (req) => {
    return authService.getMe(requireUser(req).id);
  });

  app.patch(ROUTES.usersMe, { preHandler: [app.authenticate] }, async (req) => {
    const body = parseBody(updateMeBodySchema, req.body);
    return authService.updateMe(requireUser(req).id, body);
  });

  app.put(ROUTES.usersMePassword, { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parseBody(changePasswordBodySchema, req.body);
    await authService.changePassword(requireUser(req).id, body);
    return reply.status(204).send();
  });

  // 解绑只动本地身份表，UC_ENABLED=false 时同样可用（曾开启后关闭的场景）
  app.delete(ROUTES.usersMeUcIdentity, { preHandler: [app.authenticate] }, async (req, reply) => {
    await ssoService.unbindUc(requireUser(req).id);
    return reply.status(204).send();
  });
}
