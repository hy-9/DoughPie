/**
 * 检查点① 手工/半自动冒烟脚本（非 vitest）：打真实运行的 server。
 * 用法：先起服务（pnpm -F @doughpie/server dev），另开终端执行
 *   node apps/server/scripts/smoke-e2e.mjs        # 默认 http://localhost:8699
 * 覆盖检查点①四件事：双模式登录（本地）/ 权限矩阵 / CRUD / 提及确认闭环（+ 重复任务/乐观锁）。
 * 注意：首注册用户会成为实例 admin，建议在干净的开发库上跑（脚本会自行提示）。
 */

const BASE = process.env.API_BASE ?? "http://localhost:8699/api/v1";
let failures = 0;

function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

async function call(method, path, { body, token, ifMatch } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (ifMatch !== undefined) headers["If-Match"] = String(ifMatch);
  const init = { method, headers };
  // 关键：无 body 不得带 content-type: application/json（Fastify 拒绝空 JSON body → 400）
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

const rnd = Math.random().toString(36).slice(2, 8);
const U = (name) => `${name}_${rnd}`;

// ---------- 认证与权限 ----------
const ownerReg = await call("POST", "/auth/register", {
  body: { username: U("owner"), password: "abc12345", display_name: "老板" },
});
check("注册 owner（首用户）", ownerReg.status === 201, `status=${ownerReg.status}`);
const owner = ownerReg.data;
const ownerH = { token: owner.access_token };

const me = await call("GET", "/users/me", ownerH);
check("首注册用户为实例 admin", me.data?.role === "admin", `role=${me.data?.role}`);

const badLogin = await call("POST", "/auth/login", {
  body: { username: U("owner"), password: "wrong1234" },
});
check("错误密码 → 401 INVALID_CREDENTIALS", badLogin.data?.code === "INVALID_CREDENTIALS");

const memberReg = await call("POST", "/auth/register", {
  body: { username: U("member"), password: "abc12345", display_name: "成员甲" },
});
const viewerReg = await call("POST", "/auth/register", {
  body: { username: U("viewer"), password: "abc12345", display_name: "观察员" },
});
const member = memberReg.data;
const viewer = viewerReg.data;
const memberH = { token: member.access_token };
const viewerH = { token: viewer.access_token };

// ---------- 工作区 / 邀请 / 权限矩阵 ----------
const wsRes = await call("POST", "/workspaces", { ...ownerH, body: { name: "冒烟工作区" } });
check("创建工作区", wsRes.status === 201, `status=${wsRes.status}`);
const ws = wsRes.data;

const inviteMember = await call("POST", `/workspaces/${ws.id}/invites`, {
  ...ownerH,
  body: { role: "member" },
});
const inviteViewer = await call("POST", `/workspaces/${ws.id}/invites`, {
  ...ownerH,
  body: { role: "viewer" },
});
check(
  "owner 建邀请链接（member/viewer）",
  inviteMember.status === 201 && inviteViewer.status === 201,
);

const preview = await call("GET", `/invites/${inviteMember.data.code}`, memberH);
check(
  "邀请预览返回工作区名/角色",
  preview.data?.workspace_name === "冒烟工作区" && preview.data?.role === "member",
);

const accept = await call("POST", "/invites/accept", {
  ...memberH,
  body: { code: inviteMember.data.code },
});
check(
  "member 接受邀请入区",
  accept.status === 200 || accept.status === 201,
  `status=${accept.status}`,
);
const acceptViewer = await call("POST", "/invites/accept", {
  ...viewerH,
  body: { code: inviteViewer.data.code },
});
check("viewer 接受邀请入区", acceptViewer.status < 300);

const again = await call("POST", "/invites/accept", {
  ...memberH,
  body: { code: inviteMember.data.code },
});
check(
  "重复入区 → 409 ALREADY_MEMBER",
  again.status === 409 && again.data?.code === "ALREADY_MEMBER",
);

const members = await call("GET", `/workspaces/${ws.id}/members`, ownerH);
check("成员列表 3 人", members.data?.length === 3, `count=${members.data?.length}`);
const memberId = me.data ? (await call("GET", "/users/me", memberH)).data.id : null;

// ---------- 清单 / 任务 CRUD / 乐观锁 / 权限 ----------
const listRes = await call("POST", `/workspaces/${ws.id}/lists`, {
  ...ownerH,
  body: { name: "迭代一", color: "#2563EB" },
});
check("创建清单", listRes.status === 201);
const list = listRes.data;

const taskRes = await call("POST", `/workspaces/${ws.id}/tasks`, {
  ...ownerH,
  body: {
    list_id: list.id,
    title: "写设计稿",
    priority: "high",
    due_at: new Date(Date.now() + 86400000).toISOString(),
    assignee_id: memberId,
  },
});
check("创建任务并指派 member", taskRes.status === 201, `status=${taskRes.status}`);
const task = taskRes.data;
check("任务 DTO 带子任务计数 0/0", task.subtask_total === 0 && task.subtask_done === 0);

const viewerWrite = await call("POST", `/workspaces/${ws.id}/tasks`, {
  ...viewerH,
  body: { list_id: list.id, title: "viewer 偷建" },
});
check("viewer 写任务 → 403（权限矩阵）", viewerWrite.status === 403);

const conflict = await call("PATCH", `/tasks/${task.id}`, {
  ...ownerH,
  ifMatch: 999,
  body: { title: "冲突" },
});
check(
  "If-Match 版本不符 → 409 VERSION_CONFLICT",
  conflict.status === 409 && conflict.data?.code === "VERSION_CONFLICT",
);

const noIfMatch = await call("PATCH", `/tasks/${task.id}`, { ...ownerH, body: { title: "缺头" } });
check("缺 If-Match → 400", noIfMatch.status === 400);

const flow = await call("PATCH", `/tasks/${task.id}`, {
  ...memberH,
  ifMatch: task.version,
  body: { status: "doing" },
});
check(
  "member 流转 todo→doing（version+1）",
  flow.status === 200 && flow.data?.version === task.version + 1,
);

// 子任务
const sub1 = await call("POST", `/tasks/${task.id}/subtasks`, {
  ...memberH,
  body: { title: "子一" },
});
await call("POST", `/tasks/${task.id}/subtasks`, { ...memberH, body: { title: "子二" } });
await call("PATCH", `/subtasks/${sub1.data.id}`, { ...memberH, body: { done: true } });
const taskDetail = await call("GET", `/tasks/${task.id}`, ownerH);
check(
  "子任务进度 1/2 随 DTO",
  taskDetail.data?.subtask_total === 2 && taskDetail.data?.subtask_done === 1,
);

// ---------- 提及确认闭环（PLAN.md §5.5） ----------
const comment = await call("POST", `/tasks/${task.id}/comments`, {
  ...ownerH,
  body: { content: `@${U("member")} 请看一下这个设计稿` },
});
check("评论含 @提及", comment.status === 201, `status=${comment.status}`);
const mentions = comment.data?.mentions ?? [];
check("提及解析出 member（pending）", mentions.length === 1 && mentions[0].acked_at === null);

const memberNtf = await call("GET", "/notifications?unread_only=true", memberH);
const mentionNtf = memberNtf.data?.items?.find((n) => n.type === "mention");
check("member 收到 mention 通知（high）", !!mentionNtf && mentionNtf.level === "high");

const ack = await call("POST", `/notifications/${mentionNtf?.id}/ack`, memberH);
check("member 点「收到」ack", ack.status === 200 && ack.data?.ack_at !== null);

const commentsAfter = await call("GET", `/tasks/${task.id}/comments`, ownerH);
const c0 = commentsAfter.data?.items?.[0];
check(
  "评论区回显 @member ✅已确认",
  c0?.mentions?.[0]?.acked_at !== null,
  c0?.mentions?.[0]?.acked_at ?? "",
);

// 再提醒节流：再 @一次形成未确认提及
const comment2 = await call("POST", `/tasks/${task.id}/comments`, {
  ...ownerH,
  body: { content: `再 @${U("member")} 一次` },
});
check("第二次提及落笔", comment2.status === 201);
const remind1 = await call("POST", `/tasks/${task.id}/mentions/${memberId}/remind`, ownerH);
check("发起者再提醒 → 放行", remind1.status < 300, `status=${remind1.status}`);
const remind2 = await call("POST", `/tasks/${task.id}/mentions/${memberId}/remind`, ownerH);
check(
  "24h 内重复再提醒 → 429 REMIND_THROTTLED",
  remind2.status === 429 && remind2.data?.code === "REMIND_THROTTLED",
);
const remindByOther = await call("POST", `/tasks/${task.id}/mentions/${memberId}/remind`, viewerH);
check("viewer 发起再提醒 → 403（非发起人且只读）", remindByOther.status === 403);

// ---------- 重复任务（仅 done 触发下一实例） ----------
const recurTask = await call("POST", `/workspaces/${ws.id}/tasks`, {
  ...ownerH,
  body: {
    list_id: list.id,
    title: "每周例会纪要",
    due_at: new Date(Date.now() + 86400000).toISOString(),
    recurrence: { freq: "weekly", interval: 1, by_weekday: [1] },
  },
});
await call("PATCH", `/tasks/${recurTask.data.id}`, {
  ...ownerH,
  ifMatch: recurTask.data.version,
  body: { status: "review" },
});
const afterReview = await call("GET", `/workspaces/${ws.id}/tasks?list_id=${list.id}`, ownerH);
check(
  "review 不触发下一实例",
  afterReview.data.items.filter((t) => t.title === "每周例会纪要").length === 1,
);
const recurDone = await call("PATCH", `/tasks/${recurTask.data.id}`, {
  ...ownerH,
  ifMatch: recurTask.data.version + 1,
  body: { status: "done" },
});
check("重复任务进 done", recurDone.status === 200);
const afterDone = await call("GET", `/workspaces/${ws.id}/tasks?list_id=${list.id}`, ownerH);
const recurs = afterDone.data.items.filter((t) => t.title === "每周例会纪要");
check(
  "done 触发下一实例（共 2 条，后继 todo）",
  recurs.length === 2 && recurs.some((t) => t.status === "todo" && t.id !== recurTask.data.id),
);

// ---------- 智能视图 / 搜索 / events 游标 ----------
const mine = await call("GET", `/workspaces/${ws.id}/tasks?view=mine`, memberH);
check(
  "智能视图 mine 命中被指派的任务",
  mine.data.items.some((t) => t.id === task.id),
);
const overdueQ = await call("GET", `/workspaces/${ws.id}/tasks?view=overdue`, ownerH);
check("智能视图 overdue 返回合法页", Array.isArray(overdueQ.data?.items));
const search = await call(
  "GET",
  `/workspaces/${ws.id}/tasks?q=${encodeURIComponent("设计稿")}`,
  ownerH,
);
check(
  "搜索 q=设计稿 命中标题",
  search.data.items.some((t) => t.id === task.id),
);
const events = await call("GET", `/workspaces/${ws.id}/events`, ownerH);
check(
  "events 游标端点返回事件流（id 为字符串）",
  events.data?.items?.length > 0 && typeof events.data.items[0].id === "string",
);

// ---------- 通知已读 / admin / 登出 ----------
const read = await call("POST", "/notifications/read", {
  ...memberH,
  body: { ids: [mentionNtf.id] },
});
check("通知手动已读", read.status < 300);

const adminList = await call("GET", "/admin/users", ownerH);
check("admin 用户列表", adminList.status === 200 && adminList.data.length >= 3);
const adminForbidden = await call("GET", "/admin/users", memberH);
check("非 admin 访问实例管理 → 403", adminForbidden.status === 403);

// viewer 变量是令牌对（register 返回 TokenPair），用户 id 需走 /users/me 取
const viewerId = (await call("GET", "/users/me", viewerH)).data.id;
const disable = await call("PATCH", `/admin/users/${viewerId}`, {
  ...ownerH,
  body: { status: "disabled" },
});
check("admin 禁用 viewer", disable.status === 200);
const viewerMe = await call("GET", "/users/me", viewerH);
check("禁用后旧 token 立即失效", viewerMe.status === 401 || viewerMe.status === 403);

const logout = await call("POST", "/auth/logout", {
  ...ownerH,
  body: { refresh_token: owner.refresh_token },
});
check("登出", logout.status === 204);
const reuseOld = await call("POST", "/auth/refresh", {
  body: { refresh_token: owner.refresh_token },
});
check("登出后旧 refresh 串 → 401 重用检测", reuseOld.status === 401);

console.log(failures === 0 ? "\n全部冒烟用例 PASS" : `\n${failures} 条 FAIL`);
process.exit(failures === 0 ? 0 : 1);
