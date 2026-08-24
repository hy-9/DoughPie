# 豆排排 · MCP 专项文档

> 拆分自 PLAN.md v4（2026-08）。产品规格与跨端架构以 [PLAN.md](./PLAN.md) 为 SSOT；
> 本文档是 MCP（Server P1 / Client P2）实现指南。

---

## 1. 定位

- **MCP Server（P1）**：把 豆排排 暴露给 AI 助手（Claude 等）读写待办、查进度、办通知
- **MCP Client（P2）**：豆排排 作为 client 接外部 MCP server，把外部工具结果接入（可转本地通知）
- 实现：`@modelcontextprotocol/sdk`，复用 apps/server 的 service 层（HTTP 与 MCP 都是薄适配器）

## 2. 规范基线（2026-08 核查，重要）

按 MCP 最新规范 **2026-07-28** 实现：

- **无状态化**：无 session、无 initialize 握手；capabilities 随每个请求的 `_meta` 携带；
  实现 `server/discover` 能力发现
- **MRTR（InputRequiredResult）**：服务端主动请求（elicitation/sampling 旧模式）已被取代——
  只能在响应客户端请求的流程里夹带输入请求
- **`subscriptions/listen`**：取代 `resources/subscribe` 与 HTTP GET SSE 端点
  （见 §4 系统→AI 订阅）
- **⚠️ 技术风险**：TS SDK 跟进新规范通常滞后。**P1-H 开工第一件事 = spike 验证 SDK 实际支持度**
  （stateless / discover / resultType / subscriptions-listen 四项逐一验证），再决定按新版还是
  2025-11-25 兼容版实现

## 3. Server 挂载与认证

- 挂载：apps/server 的 `/mcp` 路径，Streamable HTTP transport（不另起进程，复用连接池）
- 认证：Bearer = 本地 `mcp_tokens`（按 workspace 签发，web 设置页管理），
  **继承签发者角色**（viewer 的 token 天然只读）
- token 策略：每用户每工作区可建多个，可命名/可吊销/可选 90 天过期；限流 60 次/分钟/token（对齐 UC 限流风格）
- 桥接包：另发 `todomcp-mcp` npx stdio→HTTP 桥接（Claude Desktop 等 stdio-only 客户端）

## 4. 工具集

### 任务工具集
```
task_list(list_id?, assignee?, status?, due_before?)   # 查询/拉清单
task_create(title, list_id, assignee?, due_at?, ...)
task_update(task_id, patch)                            # 含状态流转（四态）
task_complete(task_id) / task_reopen(task_id)
task_search(query)
progress_summary(scope: list|workspace)                # 完成率/逾期数/按人统计
```

### 通知工具集（PLAN.md §5 通知系统的 MCP 暴露面）
```
notification_list(unread_only?, level?, type?, cursor?)  # AI 拉取通知（拉模型最可靠路径）
notification_mark_read(ids[])
mention_ack(notification_id)                             # 确认收到（复用提及确认闭环）
mention_pending(task_id?)                                # 查「@了谁还没确认」
comment_add(task_id, content)                            # 评论（含 @解析，触发正常扇出）
task_watch(task_id) / task_unwatch(task_id)              # 关注管理
```

### AI 代发通知（守门设计）
```
notification_send(user_ids, content, level?)
```
- 限流 10 次/分钟/token；等级上限 🟠（🔴 仅系统类型可发）；全部进 events 审计
- 防 AI 抽风/prompt 注入轰炸全组

## 5. 系统→AI 订阅（`subscriptions/listen`）

- 暴露 resources：`todo://notifications`、`todo://tasks/{id}`、`todo://workspaces/{id}/activity`
- 客户端 `subscriptions/listen` 订阅（opt-in `resourceSubscriptions=[URI]`）→
  变化时收 `notifications/resources/updated`（带 subscriptionId）；stdio/HTTP 均支持
- **明确边界**：规范明文无 Last-Event-ID 重放、断开即失效需重新订阅——仅覆盖"AI 在线"场景；
  客户端不支持则静默降级

## 6. 三条链路的边界（设计共识）

```
AI 查通知：    ✅ tools 拉取（最可靠，AI 是拉模型）
AI 触发→人收推送：✅ 天然成立——tools 复用 service 层 → events → 通知引擎扇出，零额外开发
系统推给 AI：  ⚠️ 仅连接内订阅（§5）；MCP 不承担系统推送主通道职责
人收提醒主通道：  通知中心 + Expo Push + web-push + 桌面本地通知（PLAN.md §5.8）
```

## 7. Tasks 扩展（P2 可选）

`io.modelcontextprotocol/tasks`：长操作（批量导入/报表生成）返回持久句柄，
客户端轮询进度、断线续查。视 AI 侧重活需求再启用。

## 8. Client（P2）

- 后端代理连接外部 MCP server（浏览器直连有 CORS/密钥安全问题），设置页登记 URL
- 外部工具查询结果可经通知引擎转成本地 system 通知（可选）

## 9. 工作包映射（详见 PLAN.md §9）

P1-H：MCP Server（挂载/认证/工具集/订阅）+ stdio 桥接包 + 心跳上报 ｜ P2：MCP Client、Tasks 扩展

## 10. MCP 风险

| 风险 | 对策 |
|---|---|
| TS SDK 对 2026-07-28 规范支持滞后 | P1-H 开工先 spike 四项能力；必要时按 2025-11-25 兼容版实现 |
| AI 代发通知被滥用/注入 | notification_send 限流+等级上限+审计（§4） |
| 订阅能力客户端呈现参差 | 静默降级，不作为主链路（§5 边界声明） |
