import {
  ROUTES,
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  registerBodySchema,
} from "@doughpie/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { AuthService, RequestCtx } from "../services/auth-service.js";

/**
 * 认证路由（薄）：注册/登录/刷新/退出。业务逻辑全在 authService。
 * 请求体契约一律从 @doughpie/shared 导入（冻结契约，禁止本地重复声明）。
 */

export function requestCtx(req: FastifyRequest): RequestCtx {
  return { ip: req.ip, deviceInfo: req.headers["user-agent"] };
}

export function registerAuthRoutes(app: FastifyInstance, deps: { authService: AuthService }): void {
  const { authService } = deps;

  app.post(ROUTES.authRegister, async (req, reply) => {
    const body = parseBody(registerBodySchema, req.body);
    const { tokens } = await authService.register(body, requestCtx(req));
    return reply.status(201).send(tokens);
  });

  app.post(ROUTES.authLogin, async (req, reply) => {
    const body = parseBody(loginBodySchema, req.body);
    const { tokens } = await authService.login(body, requestCtx(req));
    return reply.send(tokens);
  });

  app.post(ROUTES.authRefresh, async (req, reply) => {
    const body = parseBody(refreshBodySchema, req.body);
    return reply.send(await authService.refresh(body.refresh_token));
  });

  app.post(ROUTES.authLogout, async (req, reply) => {
    const body = parseBody(logoutBodySchema, req.body);
    await authService.logout(body.refresh_token);
    return reply.status(204).send();
  });

  app.post(ROUTES.authLogoutAll, { preHandler: [app.authenticate] }, async (req, reply) => {
    await authService.logoutAll(requireUser(req).id);
    return reply.status(204).send();
  });
}
