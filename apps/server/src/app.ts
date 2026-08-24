import Fastify, { type FastifyInstance } from "fastify";
import { API_PREFIX } from "@doughpie/shared";
import { createDb } from "./db.js";
import { loadEnv, type AppEnv } from "./env.js";
import { installAuthPlugin } from "./plugins/auth.js";
import { installErrorHandler } from "./plugins/errors.js";
import { registerAdminRoutes } from "./routes/admin-routes.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerCommentRoutes } from "./routes/comment-routes.js";
import { registerEventRoutes } from "./routes/event-routes.js";
import { registerListRoutes } from "./routes/list-routes.js";
import { registerNotificationRoutes } from "./routes/notification-routes.js";
import { registerSsoRoutes } from "./routes/sso-routes.js";
import { registerSubtaskRoutes } from "./routes/subtask-routes.js";
import { registerTaskRoutes } from "./routes/task-routes.js";
import { registerUserRoutes } from "./routes/user-routes.js";
import { registerWorkspaceRoutes } from "./routes/workspace-routes.js";
import { createAdminService, type AdminService } from "./services/admin-service.js";
import { createAuthService, type AuthService } from "./services/auth-service.js";
import { createCommentService, type CommentService } from "./services/comment-service.js";
import { createEventService, type EventService } from "./services/event-service.js";
import { createListService, type ListService } from "./services/list-service.js";
import { LoginGuard } from "./services/login-guard.js";
import {
  createNotificationService,
  type NotificationService,
} from "./services/notification-service.js";
import { createSsoService, type SsoService } from "./services/sso-service.js";
import { createSubtaskService, type SubtaskService } from "./services/subtask-service.js";
import { createTaskService, type TaskService } from "./services/task-service.js";
import { createTokenService, type TokenService } from "./services/token-service.js";
import { createWorkspaceService, type WorkspaceService } from "./services/workspace-service.js";
import { createForceLogoutCache, startForceLogoutPoller } from "./uc/force-logout.js";
import { createUcClient, type UcClient } from "./uc/uc-client.js";

/** 服务层容器（HTTP 与 MCP 都是它的薄适配器，conventions.md §3.2） */
export interface AppServices {
  authService: AuthService;
  adminService: AdminService;
  ssoService: SsoService;
  tokenService: TokenService;
  workspaceService: WorkspaceService;
  listService: ListService;
  taskService: TaskService;
  subtaskService: SubtaskService;
  commentService: CommentService;
  notificationService: NotificationService;
  eventService: EventService;
}

declare module "fastify" {
  interface FastifyInstance {
    services: AppServices;
  }
}

/**
 * Fastify 实例装配（与 listen 分离，供集成测试 inject 使用，conventions.md §5.1）。
 * 分层纪律：routes 薄 / services 厚；ucClient 可注入（测试 mock，禁真实网络）。
 */
export interface BuildAppOptions {
  env?: AppEnv;
  ucClient?: UcClient;
  /** 默认 UC_ENABLED 时启动强退轮询；测试可关 */
  startUcPoller?: boolean;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();
  const app = Fastify({
    // pino 日志：中文消息、request-id 贯穿（conventions.md §3.3）
    logger: options.logger ?? true,
  });
  installErrorHandler(app);

  const { db, client } = createDb(env.databaseUrl);
  app.addHook("onClose", async () => {
    await client.end();
  });

  const tokenService = createTokenService({
    db,
    jwtSecret: env.jwtSecret,
    accessTokenTtlSec: env.accessTokenTtlSec,
    refreshTokenTtlDays: env.refreshTokenTtlDays,
  });
  const loginGuard = new LoginGuard({
    maxFailures: env.loginMaxFailures,
    lockMinutes: env.loginLockMinutes,
  });
  // UC 强退水位线缓存（按本地 userId 维度，§2.5）
  const forceLogoutCache = createForceLogoutCache();
  const authService = createAuthService({
    db,
    tokenService,
    loginGuard,
    loginLockMinutes: env.loginLockMinutes,
    uc: env.uc.enabled
      ? { getForceLogoutBefore: (userId) => forceLogoutCache.get(userId) }
      : undefined,
  });
  const adminService = createAdminService({ db, tokenService });
  const ssoService = createSsoService({
    db,
    tokenService,
    authService,
    jwtSecret: env.jwtSecret,
    uc: env.uc,
    ucClient: options.ucClient ?? createUcClient(env.uc),
  });

  // B2 领域服务：工作区/清单/任务/子任务/评论/通知/events（业务写与 events 同事务）
  const workspaceService = createWorkspaceService({ db });
  const listService = createListService({ db });
  const taskService = createTaskService({ db });
  const subtaskService = createSubtaskService({ db });
  const commentService = createCommentService({ db });
  const notificationService = createNotificationService({ db });
  const eventService = createEventService({ db });

  installAuthPlugin(app, { db, tokenService });

  // 暴露服务层（测试与后续 MCP 薄适配器复用；HTTP 只是适配器之一）
  app.decorate("services", {
    authService,
    adminService,
    ssoService,
    tokenService,
    workspaceService,
    listService,
    taskService,
    subtaskService,
    commentService,
    notificationService,
    eventService,
  });

  app.get(`${API_PREFIX}/health`, async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      registerAuthRoutes(v1, { authService });
      registerUserRoutes(v1, { authService, ssoService });
      registerSsoRoutes(v1, { ssoService, ucEnabled: env.uc.enabled });
      registerAdminRoutes(v1, { adminService });
      registerWorkspaceRoutes(v1, { workspaceService });
      registerListRoutes(v1, { listService });
      registerTaskRoutes(v1, { taskService });
      registerSubtaskRoutes(v1, { subtaskService });
      registerCommentRoutes(v1, { commentService });
      registerNotificationRoutes(v1, { notificationService });
      registerEventRoutes(v1, { eventService, db });
    },
    { prefix: API_PREFIX },
  );

  // UC 强退传播：仅 UC_ENABLED=true 时启动（§2.5：false 时静默关闭）
  if (env.uc.enabled && options.startUcPoller !== false) {
    const poller = startForceLogoutPoller({
      db,
      ucClient: options.ucClient ?? createUcClient(env.uc),
      cache: forceLogoutCache,
      log: app.log,
    });
    app.addHook("onClose", async () => {
      poller.stop();
    });
  }

  return app;
}
