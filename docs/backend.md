# 豆排排 · 后端专项文档

> 拆分自 PLAN.md v4（2026-08）。产品规格与跨端架构以 [PLAN.md](./PLAN.md) 为唯一事实源（SSOT）；
> 本文档是后端（apps/server）实现指南。冲突时以 PLAN.md 为准。

---

## 1. 技术栈与结构

| 组件 | 选型 | 备注 |
|---|---|---|
| 运行时/框架 | Node 20 + TypeScript + Fastify | 轻、快、插件体系干净 |
| ORM/DB | Drizzle + PostgreSQL 16 | 迁移轻；不引入 Redis |
| 队列/定时 | pg-boss | 复用 PG；提醒扫描与一次性投递 job |
| 密码哈希 | @node-rs/argon2 | 与 UC 同算法家族 |
| 会话令牌 | 自签 JWT HS256（env 密钥）+ 不透明 refresh（SHA-256 哈希存储/轮换/重用检测） | 一条代码路径服务两种登录通道 |
| API 风格 | REST + zod + OpenAPI（openapi-typescript 生成 client） | service 层一等公民，HTTP 与 MCP 都是薄适配器 |
| 实时 | Socket.IO（rooms=workspace） | 正确性依赖 events 游标而非 socket 可靠性 |

```
apps/server/src/
  routes/        # Fastify 路由（薄）：REST + zod 校验 → 调 service
  services/      # 业务逻辑层（一等公民）：listService/taskService/authService/notifyService...
  models/        # Drizzle schema + 迁移
  plugins/       # auth 中间件、错误处理（扁平 {code,message}，对齐 UC 风格）、OpenAPI
  realtime/      # Socket.IO 装配、rooms、presence、events 广播
  jobs/          # pg-boss：提醒扫描、投递、每日汇总、UC 治理轮询
  uc/            # UC 对接：JWKS 拉取（备用）、force-logout 轮询、心跳/用量上报、SSO 薄代理
  mcp/           # MCP Server 挂载（见 mcp.md，P1）
```

## 2. 双模式用户体系（认证核心）

### 2.1 原则
身份归身份，登录归登录。豆排排 自含用户表/密码凭证/会话令牌（可独立运行）；
UC 仅在登录时刻作为外部身份提供者（同 UC 之于 GitHub 的关系）。

### 2.2 数据模型（三层）
```
users             id(UUIDv7), username(全局唯一,≥2字符可中文), password_hash(可空),
                  display_name, status(active/disabled), role('admin'|'user',实例级), created_at, updated_at
user_identities   user_id + provider('uc') + provider_user_id(UC的sub), unique(provider, provider_user_id)
refresh_tokens    token只存SHA-256哈希, 设备信息, created_at, last_seen_at, revoked_at
```
密码规则与 UC 一致：≥8 位含字母+数字。password_hash 可空 = UC-only 账号（可补设本地密码变混合账号）。

### 2.3 会话令牌（统一自签）
- access：自签 JWT HS256，30 分钟；claims `sub/iat/exp/jti/sid`
- refresh：不透明随机串，30 天滑动，轮换 + 重用检测（复用旧 refresh → 吊销全部会话）
- 中间件只验自签 JWT——两种登录通道发同一种 token，下游无感知
- 改密 → 全端下线；本地登录防爆破（内存计数，10 次锁 15 分钟，单进程假设已记录）

### 2.4 入口矩阵与首登交互（定稿：先问后建）
| 入口 | 行为 |
|---|---|
| `POST /api/v1/auth/register` | 真实本地注册 |
| `POST /api/v1/auth/login` | 本地密码登录（限流/锁定） |
| `POST /api/v1/auth/refresh` / `logout` / `logout-all` | 自管；静默刷新单飞 |
| `PUT /api/v1/users/me/password` | 改密→全端下线；UC-only 可"设置本地密码" |
| `GET /auth/sso/start` → UC authorize → `/auth/callback` | 仅 UC_ENABLED=true 出现；后端持 client_secret 换 token |
| 设置页绑定/解绑 UC 身份 | 解绑保护：无本地密码且仅剩该身份 → 禁止解绑 |

**首次 SSO 无绑定交互流**：
```
SSO callback → 无绑定 → 发 5 分钟一次性 pending_sso 票据（含 UC sub/username）
  → 前端弹选择页：
    a)「关联已有账号」：输本地用户名+密码 → 校验(计入防爆破) → 绑定 → 发 token
    b)「创建新账号」：预填 UC username（可改，冲突加后缀）→ 建号+绑定 → 发 token
```
登录页：本地账密表单为主；UC_ENABLED 时显示「使用统一认证登录」按钮，未配置则完全隐藏。

### 2.5 UC 治理传播（定稿：传播）
uc 绑定用户后台 60s 缓存轮询 `GET /auth/force-logout-ts`（Basic=client 凭证），
`本地会话签发时间 < force_logout_before` → 吊销本地 refresh tokens。UC_ENABLED=false 时静默关闭。

### 2.6 配置与联调
```
UC_ENABLED=false   # 默认独立运行
UC_BASE_URL / UC_CLIENT_ID / UC_CLIENT_SECRET / UC_REDIRECT_URI
```
端口：UC `8698`，server `8699`，web `5173`（Vite 代理 `/uc/*→8698`、`/api/*→8699`）；
UC 侧 `DEMO_CLIENT_ID=doughpie` 种子，redirect_uri 白名单精确匹配 `http://localhost:5173/auth/callback`。

### 2.7 心跳/用量上报（P1，仅 uc 绑定用户）
每 5 分钟批量上报 socket 在线用户心跳（裸数组 `[{user_id: UC的sub, at?}]`）；每日聚合上报调用量。

### 2.8 实例管理（P0-16）
- 首个注册用户自动为实例 admin；实例角色与 workspace 角色互不相干
- `/admin/users`：列表（用户名/昵称/状态/来源 本地|uc）、禁用、重置密码（一次性临时密码）、
  角色切换（**降级最后一个 admin 返回 409**）；写操作打审计事件
- 禁用用户 → 吊销其全部本地会话 + 踢出 socket 房间

### 2.9 已验证 UC 契约要点（以代码为准）
- `POST /oauth/token` 请求体：`{code, client_id, client_secret, redirect_uri, code_verifier}`，**无 grant_type**
- `POST /internal/heartbeat` / `usage-report` 请求体为**裸 JSON 数组**（非 `{items:[]}` 包裹）
- userinfo：`{id, username, role, client_id}`，**无 email/头像**
- Access claims：`sub/iat/exp/jti/client_id?/sid?`；错误结构扁平 `{code,message}`

## 3. 数据模型（Drizzle 草案，v4 全量）

核心表：`users`、`user_identities`、`refresh_tokens`、`workspaces`、
`memberships(user_id, workspace_id, role)`、`invites`、`lists`（color/sort_order，预留 list_members）、
`tasks`、`subtasks`、`comments`、`events`、`notifications`、`task_watchers`、
`user_notification_prefs`、`push_tokens`、`attachments`（多态）、`mcp_tokens`。

tasks 关键字段：`id, workspace_id, list_id, title, description, assignee_id,
status('todo'|'doing'|'review'|'done'), priority, start_at(可空), due_at, remind_at,
recurrence(jsonb?), sort_order(间隙值1000), version(乐观锁), completed_at, completed_by,
deleted_at(软删除), created_by, updated_at`

comments：`id, task_id, author_id, parent_id(一级回复), content, state_at_comment(发表时任务状态),
edited_at, deleted_at(tombstone)`

notifications：`id, user_id, workspace_id, type, level, entity, entity_id, actor_id,
payload(jsonb 深链), read_at, ack_at(提及确认), created_at`

task_watchers：`task_id, user_id, notify_mode('all'|'mentions_only'|'muted'),
mute_overdue, mute_incomplete`

user_notification_prefs：`user_id, type_levels(jsonb 类型→等级映射), push_overrides(jsonb?)`

P1 表：`task_dependencies(task_id, depends_on_id, type='fs', 防环唯一约束)`、
`gantt_baselines` + `gantt_baseline_items(baseline_id, task_id, start_at, due_at)`、
`wiki_docs(id, workspace_id, parent_id, title, content, sort_order, is_home, version, created_by, updated_at)`、
`task_templates(id, workspace_id, name, payload jsonb, created_by)`、
`user_preferences(user_id, workspace_id, dashboard_layout jsonb)`。

## 4. 重复任务引擎（先测后实现）

- 规则模型：`{freq: daily|weekly|monthly, interval, by_weekday?, until?}`（jsonb）
- 下一实例基准 = **计划时间**（非完成时间）；完成时同事务生成下一实例；到点不自动生成
- 实例生成后独立；改规则只影响未来实例；monthly 月末 clamp（1/31 → 2/28|29）
- **四态语义**：仅 `done` 触发下一实例生成；`review`（待验收）不算完成
- UTC 存储 + 本地时区显示；date-fns 语义测试先行（规格推导用例，防测试同源偏差）

## 5. 附件存储（本地磁盘方案，多态挂接）

- 单文件 ≤10MB，单任务 ≤10 个；图片 sharp 缩略图 + 预览，其余图标+下载
- 白名单：图片/pdf/txt/office/zip/markdown；禁可执行（exe/dll/bat/sh/apk）
- **多态**：`attachments(entity_type: task|wiki_doc|workspace, entity_id, ...)`，一处存储三处复用
- 上传：`POST /attachments`（multipart，Fastify 原生）；落盘 `uploads/{workspace_id}/{yyyymm}/`，元数据入库
- 备份 = pg_dump + uploads rsync；验收含**恢复演练**（新机用备份拉起完整实例）

## 6. 通知引擎实现

- **数据源**：events 表（第四个消费方）——事务提交后按事件类型向关注者扇出（关注者模型见 PLAN.md §5.3）
- **定时提醒**：pg-boss 每分钟扫描 `remind_at <= now() AND status != 'done'` → 一次性投递 job（notifications 表去重）
- **每日汇总**：pg-boss cron 每日 9:00 生成 incomplete 汇总通知（任务级 `mute_incomplete` 可排除）
- **扇出适配器**（按 PLAN.md §5.2 等级→推送策略过滤）：
  - Expo Push（移动，`push_tokens` 表）
  - web-push VAPID（Web/PWA 订阅）
  - socket→本地通知（桌面在线时）
- 通知数据模型与通知中心 P0 即建；推送通道 E 阶段接通，历史通知补发逻辑就位

## 7. API 约定与权限校验

- 前缀 `/api/v1`；WS 走 `/socket.io`；OpenAPI JSON 供 openapi-typescript 生成 client
- 错误结构扁平 `{code, message}` + 标准 HTTP 码（与 UC 风格一致，api-client 统一处理）
- 分页：tasks/events/notifications 游标分页；列表 50 条 + 无限滚动
- 写操作带 `If-Match: version` 乐观锁，冲突 409（客户端强制 refetch）
- 权限：workspace 级 owner/member/viewer 三角色，**service 层每个方法入口校验**（非仅前端藏按钮）；
  MCP token 继承签发者角色（viewer 只读）
- UC 相关：SSO 薄代理端点注入 client_secret；force-logout 轮询 60s 内存缓存

## 8. 单进程约束（设计前提）

- 内存态：登录防爆破计数、presence、force-logout 缓存均为进程内存——**单进程部署假设**
- 进程重启：计数清零（可接受）；socket 自动重连 + events 游标补齐保证数据无损
- 20 人规模无高可用要求；备份恢复即灾备

## 9. 部署与备份（独立 VPS）

- 豆排排 独占一台 VPS（2C4G），Docker Compose：PG + server + web 静态 + Caddy（自动 HTTPS）
- 生产开启 SSO 时 UC 必须公网可达（如 uc.域名，UC 侧 COOKIE_SECURE=true）；
  纯独立模式（UC_ENABLED=false）零外部依赖
- 备份：pg_dump **每日** + uploads rsync 每日，**保留 14 天**，异地存放；H 阶段做**恢复演练**
- 日志：Fastify pino + 按天轮转文件（server.log 风格，对齐 UC）
- 监控：不做（docker `restart: always` + 手动巡检；20 人自用，不做伪需求）
- 环境变量：DATABASE_URL / JWT_SECRET / UC_* / VAPID_KEYS / EXPO_ACCESS_TOKEN（可选）/ PORT=8699

## 10. 工作包映射（详见 PLAN.md §9）

B1 双模式认证（本文档 §2 全量）｜B2 领域（清单/任务/子任务/重复/搜索/智能视图/筛选/评论+@+提及确认）｜
C 联调｜D 实时层服务端（events/socket/游标）｜E 通知引擎+推送通道｜F 附件｜
P1-A 通知增强包（关注者/自动已读/自定义映射）｜P1-B 状态机扩展｜P1-H 的 MCP Server + 心跳上报

## 11. 后端风险（全量风险见 PLAN.md §10）

| 风险 | 对策 |
|---|---|
| UC 契约变更 | 以本地代码为准；两处文档不符已记录（§2.9） |
| 重复任务周期坑（月末/时区/DST） | UTC + 测试先行 + 只支持三种 freq；review 不触发下一实例 |
| 关联流程被爆破 | 关联校验计入防爆破计数 |
| 附件备份不完整 | 恢复演练写进验收 |
| 单进程假设（内存限流计数） | 已记录为设计约束；重启清零可接受 |
