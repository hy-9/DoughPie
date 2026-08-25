import {
  API_PREFIX,
  ROUTES,
  type AcceptInviteBody,
  type AdminResetPasswordResult,
  type AdminUpdateUserBody,
  type ChangePasswordBody,
  type Comment,
  type CreateCommentBody,
  type CreateInviteBody,
  type CreateListBody,
  type CreateSubtaskBody,
  type CreateTaskBody,
  type CreateWorkspaceBody,
  type CursorPage,
  type EventEnvelope,
  type Invite,
  type InviteInfo,
  type List,
  type LoginBody,
  type MarkReadBody,
  type Member,
  type MoveBody,
  type Notification,
  type NotificationQuery,
  type RegisterBody,
  type SsoLinkBody,
  type SsoPending,
  type SsoRegisterBody,
  type SsoBound,
  type SsoExchangeBody,
  type SsoStartResult,
  type Subtask,
  type Task,
  type TaskQuery,
  type TokenPair,
  type UpdateCommentBody,
  type UpdateListBody,
  type UpdateMeBody,
  type UpdateMemberRoleBody,
  type UpdateSubtaskBody,
  type UpdateTaskBody,
  type UpdateWorkspaceBody,
  type User,
  type Workspace,
} from "@doughpie/shared";
import type { TokenStore } from "./token-store.js";

/** 统一 API 错误（扁平 {code,message} + HTTP 状态码，conventions.md §3.2） */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 乐观锁冲突（409）：客户端必须 refetch（PLAN.md §4） */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

export interface DoughpieClientOptions {
  /** 默认 ''：Web 开发期经 Vite 代理 / 生产经 Caddy 同源反代；移动端传完整 https 地址 */
  baseUrl?: string;
  tokenStore: TokenStore;
  /** 刷新失败（会话彻底失效）后的钩子：调用方负责跳登录页 */
  onUnauthorized?: () => void;
  /** 可注入 fetch（测试 mock / RN 适配）；禁止访问真实网络的测试必须注入 */
  fetchImpl?: typeof fetch;
}

/** SSO exchange 的三种结果（backend.md §2.4）：已绑定发令牌 / 未绑定发一次性票据 / 绑定模式完成 */
export type SsoExchangeResult =
  | { kind: "tokens"; tokens: TokenPair }
  | { kind: "pending"; pending: SsoPending }
  | { kind: "bound" };

interface RequestOptions {
  body?: unknown;
  query?: Record<string, unknown>;
  /** 乐观锁版本（PLAN.md §4：写操作带 If-Match: version） */
  ifMatch?: number;
  /** 默认 true；认证类端点（login/register/refresh/sso）为 false */
  auth?: boolean;
}

/** query 序列化：数组→重复 key；布尔→'true'/'false'（服务端 zod 显式解析）；undefined/null 跳过 */
function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (typeof value === "boolean") {
      params.set(key, value ? "true" : "false");
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * 豆排排 API client：Bearer 认证 + 401 单飞静默刷新（web.md §6）+ 乐观锁头。
 * socket 封装在 D 阶段加入（经本包统一出口）。
 */
export class DoughpieClient {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly onUnauthorized?: () => void;
  private readonly fetchImpl: typeof fetch;
  /** 单飞刷新：并发 401 只触发一次刷新，其余等待同一 Promise */
  private refreshPromise: Promise<boolean> | null = null;

  constructor(options: DoughpieClientOptions) {
    this.baseUrl = (options.baseUrl ?? "") + API_PREFIX;
    this.tokenStore = options.tokenStore;
    this.onUnauthorized = options.onUnauthorized;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async rawRequest(
    method: string,
    path: string,
    options: RequestOptions,
    accessToken: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.auth !== false && accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    if (options.ifMatch !== undefined) headers["If-Match"] = String(options.ifMatch);

    return this.fetchImpl(this.baseUrl + path + buildQuery(options.query), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = data as { code?: string; message?: string } | undefined;
      throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? res.statusText);
    }
    return data as T;
  }

  /** 主请求通道：带认证 + 401 单飞刷新重放一次 */
  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.rawRequest(method, path, options, this.tokenStore.getAccessToken());
    if (res.status !== 401 || options.auth === false) {
      return this.parseResponse<T>(res);
    }
    const refreshed = await this.ensureRefreshed();
    if (!refreshed) throw new ApiError(401, "UNAUTHORIZED", "登录已过期，请重新登录");
    const retry = await this.rawRequest(method, path, options, this.tokenStore.getAccessToken());
    if (retry.status === 401) {
      this.failUnauthorized();
      throw new ApiError(401, "UNAUTHORIZED", "登录已过期，请重新登录");
    }
    return this.parseResponse<T>(retry);
  }

  /** 单飞刷新：多请求并发 401 时共享同一次刷新 */
  private ensureRefreshed(): Promise<boolean> {
    this.refreshPromise ??= this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.tokenStore.getRefreshToken();
    if (!refreshToken) {
      this.failUnauthorized();
      return false;
    }
    try {
      const tokens = await this.requestNoAuth<TokenPair>("POST", ROUTES.authRefresh, {
        body: { refresh_token: refreshToken },
      });
      this.tokenStore.setTokens(tokens);
      return true;
    } catch {
      // 刷新失败（含 REFRESH_REUSED）：会话彻底失效
      this.failUnauthorized();
      return false;
    }
  }

  private failUnauthorized(): void {
    this.tokenStore.clear();
    this.onUnauthorized?.();
  }

  /** 无认证通道（login/register/sso 等），不走 401 刷新逻辑 */
  private requestNoAuth<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(method, path, { ...options, auth: false });
  }

  // ============================== 认证（backend.md §2.4 入口矩阵） ==============================
  readonly auth = {
    /** 注册即登录：返回令牌对 */
    register: (body: RegisterBody) =>
      this.requestNoAuth<TokenPair>("POST", ROUTES.authRegister, { body }),
    login: (body: LoginBody) => this.requestNoAuth<TokenPair>("POST", ROUTES.authLogin, { body }),
    /** 登出：把当前 refresh 串交给服务端吊销（会话级）；随后清本地 */
    logout: () =>
      this.request<void>("POST", ROUTES.authLogout, {
        body: { refresh_token: this.tokenStore.getRefreshToken() },
      }),
    logoutAll: () => this.request<void>("POST", ROUTES.authLogoutAll),
    /** SSO 起跳（仅 UC_ENABLED=true 时服务端可用，404 即隐藏入口） */
    ssoStart: (mode: "login" | "bind" = "login") =>
      this.request<SsoStartResult>("POST", ROUTES.authSsoStart, { body: { mode } }),
    /** SSO 回跳换令牌：已绑定→tokens；未绑定→pending 票据走选择页；bind 模式→bound */
    ssoExchange: async (body: SsoExchangeBody): Promise<SsoExchangeResult> => {
      const data = await this.requestNoAuth<TokenPair | SsoPending | SsoBound>(
        "POST",
        ROUTES.authSsoExchange,
        { body },
      );
      if ("access_token" in data) return { kind: "tokens", tokens: data };
      if ("pending_token" in data) return { kind: "pending", pending: data };
      return { kind: "bound" };
    },
    ssoLink: (body: SsoLinkBody) =>
      this.requestNoAuth<TokenPair>("POST", ROUTES.authSsoLink, { body }),
    ssoRegister: (body: SsoRegisterBody) =>
      this.requestNoAuth<TokenPair>("POST", ROUTES.authSsoRegister, { body }),
  };

  // ============================== 用户 ==============================
  readonly users = {
    me: () => this.request<User>("GET", ROUTES.usersMe),
    updateMe: (body: UpdateMeBody) => this.request<User>("PATCH", ROUTES.usersMe, { body }),
    /** 改密→全端下线（client 层负责在成功后清本地 token） */
    changePassword: (body: ChangePasswordBody) =>
      this.request<void>("PUT", ROUTES.usersMePassword, { body }),
    /** 解绑 UC（无本地密码时服务端 409 UNBIND_FORBIDDEN） */
    unbindUc: () => this.request<void>("DELETE", ROUTES.usersMeUcIdentity),
  };

  // ============================== 实例管理（P0-16） ==============================
  readonly admin = {
    listUsers: () => this.request<User[]>("GET", ROUTES.adminUsers),
    updateUser: (id: string, body: AdminUpdateUserBody) =>
      this.request<User>("PATCH", ROUTES.adminUser(id), { body }),
    resetPassword: (id: string) =>
      this.request<AdminResetPasswordResult>("POST", ROUTES.adminUserResetPassword(id)),
  };

  // ============================== 工作区 / 成员 / 邀请 ==============================
  readonly workspaces = {
    list: () => this.request<Workspace[]>("GET", ROUTES.workspaces),
    create: (body: CreateWorkspaceBody) =>
      this.request<Workspace>("POST", ROUTES.workspaces, { body }),
    get: (id: string) => this.request<Workspace>("GET", ROUTES.workspace(id)),
    update: (id: string, body: UpdateWorkspaceBody) =>
      this.request<Workspace>("PATCH", ROUTES.workspace(id), { body }),
    listMembers: (id: string) => this.request<Member[]>("GET", ROUTES.workspaceMembers(id)),
    updateMemberRole: (id: string, userId: string, body: UpdateMemberRoleBody) =>
      this.request<void>("PATCH", ROUTES.workspaceMember(id, userId), { body }),
    /** 移除成员；传自己的 id 即主动退出（负责任务自动置未分配，PLAN.md §8） */
    removeMember: (id: string, userId: string) =>
      this.request<void>("DELETE", ROUTES.workspaceMember(id, userId)),
    listInvites: (id: string) => this.request<Invite[]>("GET", ROUTES.workspaceInvites(id)),
    createInvite: (id: string, body: CreateInviteBody) =>
      this.request<Invite>("POST", ROUTES.workspaceInvites(id), { body }),
    revokeInvite: (id: string, inviteId: string) =>
      this.request<void>("DELETE", ROUTES.workspaceInvite(id, inviteId)),
    acceptInvite: (body: AcceptInviteBody) =>
      this.request<Workspace>("POST", ROUTES.inviteAccept, { body }),
    /** 邀请预览（接受前，登录后可访问） */
    inviteInfo: (code: string) => this.request<InviteInfo>("GET", ROUTES.inviteInfo(code)),
  };

  // ============================== 清单 ==============================
  readonly lists = {
    list: (wsId: string) => this.request<List[]>("GET", ROUTES.workspaceLists(wsId)),
    create: (wsId: string, body: CreateListBody) =>
      this.request<List>("POST", ROUTES.workspaceLists(wsId), { body }),
    update: (id: string, body: UpdateListBody) =>
      this.request<List>("PATCH", ROUTES.list(id), { body }),
    remove: (id: string) => this.request<void>("DELETE", ROUTES.list(id)),
    move: (id: string, body: MoveBody) => this.request<List>("POST", ROUTES.listMove(id), { body }),
  };

  // ============================== 任务 ==============================
  readonly tasks = {
    list: (wsId: string, query?: Partial<TaskQuery>) =>
      this.request<CursorPage<Task>>("GET", ROUTES.workspaceTasks(wsId), {
        query: query as Record<string, unknown>,
      }),
    create: (wsId: string, body: CreateTaskBody) =>
      this.request<Task>("POST", ROUTES.workspaceTasks(wsId), { body }),
    get: (id: string) => this.request<Task>("GET", ROUTES.task(id)),
    /** 写操作必须带当前 version（If-Match），409 → 调用方 refetch 后提示 */
    update: (id: string, body: UpdateTaskBody, version: number) =>
      this.request<Task>("PATCH", ROUTES.task(id), { body, ifMatch: version }),
    remove: (id: string, version: number) =>
      this.request<void>("DELETE", ROUTES.task(id), { ifMatch: version }),
    /** 列内排序（间隙值，后写者胜，无乐观锁） */
    move: (id: string, body: MoveBody) => this.request<Task>("POST", ROUTES.taskMove(id), { body }),
  };

  // ============================== 子任务 ==============================
  readonly subtasks = {
    list: (taskId: string) => this.request<Subtask[]>("GET", ROUTES.taskSubtasks(taskId)),
    create: (taskId: string, body: CreateSubtaskBody) =>
      this.request<Subtask>("POST", ROUTES.taskSubtasks(taskId), { body }),
    update: (id: string, body: UpdateSubtaskBody) =>
      this.request<Subtask>("PATCH", ROUTES.subtask(id), { body }),
    remove: (id: string) => this.request<void>("DELETE", ROUTES.subtask(id)),
  };

  // ============================== 讨论区 ==============================
  readonly comments = {
    list: (taskId: string, query?: { cursor?: string; limit?: number }) =>
      this.request<CursorPage<Comment>>("GET", ROUTES.taskComments(taskId), { query }),
    create: (taskId: string, body: CreateCommentBody) =>
      this.request<Comment>("POST", ROUTES.taskComments(taskId), { body }),
    update: (id: string, body: UpdateCommentBody) =>
      this.request<Comment>("PATCH", ROUTES.comment(id), { body }),
    remove: (id: string) => this.request<void>("DELETE", ROUTES.comment(id)),
  };

  // ============================== 通知 ==============================
  readonly notifications = {
    list: (query?: Partial<NotificationQuery>) =>
      this.request<CursorPage<Notification>>("GET", ROUTES.notifications, {
        query: query as Record<string, unknown>,
      }),
    markRead: (body: MarkReadBody) =>
      this.request<void>("POST", ROUTES.notificationsRead, { body }),
    /** 提及确认（「收到」）：mention 永不自动已读（PLAN.md §5.1） */
    ack: (id: string) => this.request<Notification>("POST", ROUTES.notificationAck(id)),
    /** 发起者对未确认提及「再提醒」（同一提及 24h 限一次，§5.5） */
    remindMention: (taskId: string, userId: string) =>
      this.request<void>("POST", ROUTES.mentionRemind(taskId, userId)),
  };

  // ============================== events 断线补齐（游标） ==============================
  readonly events = {
    list: (wsId: string, cursor?: string, limit?: number) =>
      this.request<CursorPage<EventEnvelope>>("GET", ROUTES.workspaceEvents(wsId), {
        query: { cursor, limit },
      }),
  };
}
