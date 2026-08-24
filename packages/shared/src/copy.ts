/**
 * 中文文案集中常量（PLAN.md §3：预留 i18n 平移）。
 * 只放跨端共用/契约相关文案；端内局部文案可就近定义，但禁止散落硬编码错误提示。
 */

export const COPY = {
  auth: {
    loginFailed: "用户名或密码不正确",
    loginLocked: (minutes: number) => `尝试次数过多，请 ${minutes} 分钟后再试`,
    registerSuccess: "注册成功",
    passwordRule: "密码至少 8 位，且需同时包含字母和数字",
    usernameTaken: "该用户名已被占用",
    userDisabled: "账号已被禁用，请联系管理员",
    tokenExpired: "登录已过期，请重新登录",
    refreshReused: "登录状态异常，已为你注销所有会话，请重新登录",
    ssoLinkPrompt: "检测到统一认证首次登录，请关联已有账号或创建新账号",
    pendingSsoExpired: "登录票据已过期，请重新发起统一认证登录",
    unbindForbidden: "当前账号没有本地密码，解绑后将无法登录，请先设置本地密码",
    identityBound: "该统一认证账号已被其他用户绑定",
    ucUnavailable: "统一认证服务暂时不可用，请稍后再试",
  },
  common: {
    unauthorized: "请先登录",
    forbidden: "没有权限执行此操作",
    notFound: "内容不存在或已被删除",
    versionConflict: "内容已被他人修改，已为你刷新最新数据",
    validationFailed: "提交的内容不符合要求",
    internal: "服务器开小差了，请稍后再试",
  },
  workspace: {
    inviteInvalid: "邀请链接无效或已被作废",
    inviteExpired: "邀请链接已过期",
    alreadyMember: "你已经是该工作区成员",
    lastOwner: "工作区至少需要保留一名所有者",
  },
  admin: {
    lastAdmin: "至少需要保留一名管理员",
  },
  task: {
    subtaskLimit: "子任务数量已达上限",
    recurrenceInvalid: "重复规则不合法",
  },
  mention: {
    ackDone: "已确认收到",
    remindSent: "已再次提醒对方",
    remindThrottled: "24 小时内只能提醒一次",
  },
} as const;

export type Copy = typeof COPY;
