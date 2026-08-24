# 豆排排 · Web 端专项文档

> 拆分自 PLAN.md v4（2026-08）。产品规格与跨端架构以 [PLAN.md](./PLAN.md) 为 SSOT；
> 本文档是 Web 端（apps/web，同时作为 Tauri 桌面端与 PWA 的载体）实现指南。

---

## 1. 技术栈

Vite + React 18 + TypeScript ｜ TanStack Query（服务器状态）+ Zustand（UI 状态）｜
Tailwind + shadcn/ui ｜ dnd-kit（看板拖拽）｜ cmdk（Ctrl+K 搜索）｜
recharts（仪表盘）｜ CodeMirror 6 + react-markdown（Wiki）｜ frappe-gantt（甘特）｜
next-themes（深色三态）｜ socket.io-client（经 packages/api-client 封装）

## 2. 页面地图（路由）

```
/login            本地账密 +「使用统一认证登录」（UC_ENABLED 时显示）
/register         本地注册（真实注册页）
/auth/callback    SSO 回跳 → 换 token → 或弹「关联旧号/建新号」选择页
/auth/link        首登选择页（pending_sso 票据流程，见 backend.md §2.4）
/                 看板（首屏主视图，三列渲染；review 态带「待验收」徽章）
/list/:listId     列表视图（四筛 + 排序切换 + 50 条无限滚动）
/today /mine /overdue   智能视图（P0-14，侧栏常驻）
/task/:taskId     任务详情：字段区 + 子任务 + 讨论区（评论/一级回复/@/确认状态）
/notifications    通知中心（按任务分组/三级徽标/「收到」按钮/深链锚定评论）
/activity         动态流页（P1，消费 events）
/dashboard        仪表盘（P1，5 图 + 自定义卡片）
/wiki/:docId?     工作区 Wiki（P1，Markdown 编辑+预览）
/calendar         日历月视图（P1，拖拽改期）
/gantt            甘特（P1，G1→G5 分片）
/settings         个人设置：昵称/头像/改密/绑定 UC/通知等级自定义映射/会话
/ws/:id/settings  工作区设置：成员/邀请链接/模板/门面文档指定
/admin/users      实例管理页（P0-16，仅实例 admin）
```

## 3. 状态管理约定

- **TanStack Query 为唯一服务器状态源**；Query key 与 events 实体一一映射：
  `['tasks', listId]`、`['task', id]`、`['notifications']`、`['events', cursor]`…
- socket 收到 event → 按实体 key **精确失效/写入** Query 缓存；自己不维护第二份数据副本
- **乐观更新**：mutation 先写缓存 → 失败回滚 → 409 冲突强制 refetch + UI 提示「已被 XX 修改」
- Zustand 只放 UI 态（当前工作区、侧栏折叠、看板/列表切换、主题）
- 表单全部用 `packages/shared` 的 zod schema 校验（与后端同源）

## 4. 关键视图实现要点

| 视图 | 要点 |
|---|---|
| 看板 | dnd-kit；跨列拖拽=状态流转（乐观更新+version）；列内拖拽=sort_order 间隙值；done 列折叠「最近 20 条+查看全部」；卡片含负责人头像（色块+首字符）、截止（过期红）、优先级色条、子任务进度 n/m |
| 讨论区 | 时间线 + 一级回复；@输入弹成员选择器（同搜昵称/username）；评论显示提及确认 chips（`@B✅14:32 @D⏳`）；每条评论带发表时状态徽章（P1 分段过滤） |
| 通知中心 | 按任务分组聚合（未读数徽标+类型图标）；🔴🟠⚪ 三级色标；mention 条显示「收到」按钮（点击调 mention_ack）；打开任务详情 → progress 类自动已读（前端上报已读） |
| 搜索 | cmdk 命令面板（Ctrl+K），ILIKE 标题+描述，结果行显所属清单+状态徽标，回车跳详情 |
| 深色模式 | next-themes 三态（浅/深/跟随系统）；shadcn 语义色 |
| 甘特（P1） | frappe-gantt 扩展：G1 时间轴+拖拽改期 → G2 依赖连线（防环 409 提示）→ G3 级联（batch 撤销按钮）→ G4 关键路径高亮 → G5 基线叠加 |
| Wiki（P1） | CodeMirror 编辑 + react-markdown 预览；version 乐观锁 409 提示；附件粘贴上传 |
| 仪表盘（P1） | recharts 5 图；卡片注册表 + 显示/隐藏/拖拽排序，布局存服务端 user_preferences |

## 5. 推送与 PWA

- web-push VAPID：service worker 注册订阅 → `push_tokens` 表；权限申请引导（首次进通知中心时）
- PWA 化在 H 阶段顺手完成：安装到桌面 + **断网只读缓存**（P2 条目自动获得大半）
- 桌面端（Tauri）复用本包构建产物，差异见 desktop.md

## 6. 会话与刷新

- 复用 `packages/api-client`：Bearer + **401 单飞静默刷新**（移植 userSystemUi tokenRefresh.ts 模式）
- token 存 localStorage（20 人内部工具接受 XSS 面；SSO 票据 pending_sso 5 分钟一次性）
- 刷新失败 → 清 token 跳 /login；socket 握手携带 access token，过期触发刷新后重连+游标补齐

## 7. 快捷键

Ctrl+K 搜索（P0）；N 新建任务、`/` 聚焦搜索（P1）

## 8. 工作包映射（详见 PLAN.md §9）

B3 Web 骨架（登录/注册/SSO/看板/列表/详情/讨论区基础版，对 mock 契约开发）｜
C 联调｜D 看板拖拽+实时层前端（乐观更新/socket 失效/重连补齐）｜
E 通知中心 UI + web-push｜P1-C/D/E/F 的 Web 前端部分（日历/模板/Wiki/仪表盘/甘特）

## 9. Web 端风险

| 风险 | 对策 |
|---|---|
| 乐观更新冲突静默覆盖 | version 乐观锁 + 409 refetch + UI 明示 |
| Tauri 各平台 WebView 差异（复用本包） | 锁定现代 CSS 子集；shadcn 生态默认兼容良好 |
| AI 组件风格漂移 | shadcn/ui 单一组件源 + eslint；禁止引入第二套 UI 库 |
