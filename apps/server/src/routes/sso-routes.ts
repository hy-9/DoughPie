import { COPY, ROUTES, ssoLinkBodySchema, ssoRegisterBodySchema } from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError } from "../lib/api-error.js";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { SsoService } from "../services/sso-service.js";
import { requestCtx } from "./auth-routes.js";

/**
 * UC SSO 路由（backend.md §2.4/§2.9）。
 * UC_ENABLED=false 时一律 404——前端凭 sso/start 的 404 隐藏入口。
 * start/exchange 请求体 shared 未定义契约（缺口已记录），就近声明。
 */
const ssoStartBodySchema = z.object({
  mode: z.enum(["login", "bind"]).default("login"),
});

const ssoExchangeBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export function registerSsoRoutes(
  app: FastifyInstance,
  deps: { ssoService: SsoService; ucEnabled: boolean },
): void {
  const { ssoService, ucEnabled } = deps;

  function assertUcEnabled(): void {
    if (!ucEnabled) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
  }

  app.post(ROUTES.authSsoStart, async (req) => {
    assertUcEnabled();
    const body = parseBody(ssoStartBodySchema, req.body);
    if (body.mode === "bind") {
      // 绑定模式必须先登录（设置页发起），authenticate 抛错走统一错误处理
      await app.authenticate(req);
      return ssoService.start({ mode: "bind", bindUserId: requireUser(req).id });
    }
    return ssoService.start({ mode: "login" });
  });

  app.post(ROUTES.authSsoExchange, async (req) => {
    assertUcEnabled();
    const body = parseBody(ssoExchangeBodySchema, req.body);
    const result = await ssoService.exchange(body, requestCtx(req));
    // 契约：TokenPair | SsoPending | { bound: true }
    if (result.kind === "tokens") return result.tokens;
    if (result.kind === "pending") return result.pending;
    return { bound: true };
  });

  app.post(ROUTES.authSsoLink, async (req) => {
    assertUcEnabled();
    const body = parseBody(ssoLinkBodySchema, req.body);
    const { tokens } = await ssoService.link(body, requestCtx(req));
    return tokens;
  });

  app.post(ROUTES.authSsoRegister, async (req) => {
    assertUcEnabled();
    const body = parseBody(ssoRegisterBodySchema, req.body);
    const { tokens } = await ssoService.registerWithUc(body, requestCtx(req));
    return tokens;
  });
}
