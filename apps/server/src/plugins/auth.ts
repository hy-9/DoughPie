import { eq } from "drizzle-orm";
import { COPY } from "@doughpie/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { users, type UserRow } from "../models/schema.js";
import type { TokenService } from "../services/token-service.js";

/**
 * 认证中间件（backend.md §2.3）：只验自签 JWT，两种登录通道下游无感知。
 * - 校验 Bearer JWT（purpose=access、签名、exp）
 * - 每次载用户：拒绝 disabled（禁用立即生效）
 * - 校验会话存活：refresh 吊销（改密/强退/重用检测）后旧 access 立即失效
 */

declare module "fastify" {
  interface FastifyRequest {
    /** authenticate 通过后填充；未过 authenticate 的路由为 null */
    currentUser: UserRow | null;
  }
  interface FastifyInstance {
    /** 可作 preHandler 使用，也可在 handler 内手动调用（如 SSO bind 模式按 body 条件鉴权） */
    authenticate: (req: FastifyRequest) => Promise<void>;
    requireAdmin: (req: FastifyRequest) => Promise<void>;
  }
}

export interface AuthPluginDeps {
  db: Db;
  tokenService: TokenService;
}

export function installAuthPlugin(app: FastifyInstance, deps: AuthPluginDeps): void {
  app.decorateRequest("currentUser", null);

  app.decorate("authenticate", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new ApiError(401, "UNAUTHORIZED", COPY.common.unauthorized);
    }
    const payload = await deps.tokenService.verifyAccessToken(header.slice("Bearer ".length));
    const user = await deps.db.query.users.findFirst({ where: eq(users.id, payload.sub) });
    if (!user) throw new ApiError(401, "UNAUTHORIZED", COPY.common.unauthorized);
    if (user.status === "disabled") {
      throw new ApiError(403, "USER_DISABLED", COPY.auth.userDisabled);
    }
    if (!(await deps.tokenService.isSessionAlive(payload.sid))) {
      throw new ApiError(401, "UNAUTHORIZED", COPY.common.unauthorized);
    }
    req.currentUser = user;
  });

  app.decorate("requireAdmin", async (req: FastifyRequest) => {
    if (req.currentUser?.role !== "admin") {
      throw new ApiError(403, "FORBIDDEN", COPY.common.forbidden);
    }
  });
}

/**  handler 内取当前用户（authenticate preHandler 已保证存在） */
export function requireUser(req: FastifyRequest): UserRow {
  if (!req.currentUser) throw new ApiError(500, "INTERNAL", COPY.common.internal);
  return req.currentUser;
}
