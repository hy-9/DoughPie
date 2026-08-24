/**
 * REST 路由契约（前缀 /api/v1）：server 与 api-client 的唯一路由事实源，防两端漂移。
 * 约定：写操作返回更新后的实体；任务类写操作必须带 If-Match: <version>（contracts/common）。
 */

export const API_PREFIX = "/api/v1";

export const ROUTES = {
  // ---- 认证（backend.md §2.4 入口矩阵） ----
  authRegister: "/auth/register",
  authLogin: "/auth/login",
  authRefresh: "/auth/refresh",
  authLogout: "/auth/logout",
  authLogoutAll: "/auth/logout-all",
  /** SSO：POST 起跳（返回 authorize_url），state 服务端内存暂存（含 code_verifier/mode） */
  authSsoStart: "/auth/sso/start",
  /** SSO 换 token：{ code, state } → TokenPair | SsoPending | { bound: true } */
  authSsoExchange: "/auth/sso/exchange",
  /** SSO 首登选择：关联旧号 / 建新号（pending_token 5 分钟一次性） */
  authSsoLink: "/auth/sso/link",
  authSsoRegister: "/auth/sso/register",

  // ---- 用户 ----
  usersMe: "/users/me",
  usersMePassword: "/users/me/password",
  usersMeUcIdentity: "/users/me/identities/uc",

  // ---- 实例管理（P0-16，仅实例 admin） ----
  adminUsers: "/admin/users",
  adminUser: (id: string) => `/admin/users/${id}` as const,
  adminUserResetPassword: (id: string) => `/admin/users/${id}/reset-password` as const,

  // ---- 工作区 / 成员 / 邀请 ----
  workspaces: "/workspaces",
  workspace: (id: string) => `/workspaces/${id}` as const,
  workspaceMembers: (id: string) => `/workspaces/${id}/members` as const,
  workspaceMember: (id: string, userId: string) => `/workspaces/${id}/members/${userId}` as const,
  workspaceInvites: (id: string) => `/workspaces/${id}/invites` as const,
  workspaceInvite: (id: string, inviteId: string) =>
    `/workspaces/${id}/invites/${inviteId}` as const,
  inviteAccept: "/invites/accept",

  // ---- 清单 ----
  workspaceLists: (wsId: string) => `/workspaces/${wsId}/lists` as const,
  list: (id: string) => `/lists/${id}` as const,
  listMove: (id: string) => `/lists/${id}/move` as const,

  // ---- 任务（智能视图/四筛/搜索走 query，见 taskQuerySchema） ----
  workspaceTasks: (wsId: string) => `/workspaces/${wsId}/tasks` as const,
  task: (id: string) => `/tasks/${id}` as const,
  taskMove: (id: string) => `/tasks/${id}/move` as const,

  // ---- 子任务（P0-9 仅标题+完成态） ----
  taskSubtasks: (taskId: string) => `/tasks/${taskId}/subtasks` as const,
  subtask: (id: string) => `/subtasks/${id}` as const,

  // ---- 讨论区（P0-17） ----
  taskComments: (taskId: string) => `/tasks/${taskId}/comments` as const,
  comment: (id: string) => `/comments/${id}` as const,

  // ---- 通知（PLAN.md §5） ----
  notifications: "/notifications",
  notificationsRead: "/notifications/read",
  notificationAck: (id: string) => `/notifications/${id}/ack` as const,
  /** 提及「再提醒」：发起者对同任务下某成员的最新未确认提及提醒一次（24h 节流，§5.5） */
  mentionRemind: (taskId: string, userId: string) =>
    `/tasks/${taskId}/mentions/${userId}/remind` as const,

  // ---- events 断线补齐（游标，PLAN.md §4；D 阶段 socket 复用同一数据源） ----
  workspaceEvents: (wsId: string) => `/workspaces/${wsId}/events` as const,
} as const;
