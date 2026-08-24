# 豆排排 DoughPie

> 一块会帮你打理任务的豆腐。🧈
> 面向 ≤20 人小团队的 **AI 原生多人协作待办工具**：
> Web / 移动端 / PC 桌面 / **MCP** 四端协同，实时同步，分级通知。

---

## 🎯 取名的小巧思

**豆排排** = 豆腐 + 一排排码整齐。
看板上那一列列任务卡片，就是码放整齐的豆腐块——通俗、有画面，自带「整理规划」的意象。

**DoughPie** = dough（面团 /doʊ/ ≈ 豆）+ pie（派 /paɪ/ ≈ 排）。
老外念 DoughPie，几乎就是在念「豆排排」；而且 dough 和 pie 都是食物，
与豆腐的美食主题一脉相承。中西两个语境各自成立、互为谐音。

**todomcp-mcp** = MCP 桥接包保留了项目的原始代号（todo + MCP），名实相符，零浪费。

## 🤖 MCP：AI 是协作体系的一等公民

豆排排不是「支持 MCP 的待办工具」，而是**把 AI 助手设计成了团队协作的原生角色**——
它能接活、能派活、能催办、能汇报。

### 一句话体验

```
你（对 Claude 说）：「给李四建个任务：周五前交设计稿，高优先级。」
        │
Claude → task_create（MCP 工具）→ service 层 → events → 通知引擎
        │
        ▼
📱 李四手机立刻弹出系统推送：「你被分配了任务：周五前交设计稿」
```

**李四不需要装 Claude、不需要懂 MCP**——AI 派活，人走普通人的推送通道收提醒。

### 工具集（复用业务 service 层，权限继承签发者角色）

| 类别 | 工具 |
|---|---|
| 任务 | `task_list` / `task_create` / `task_update` / `task_complete` / `task_reopen` / `task_search` / `progress_summary` |
| 通知 | `notification_list` / `notification_mark_read` / **`mention_ack`（确认收到）** / `mention_pending` / `comment_add` / `task_watch` / `task_unwatch` |
| 代发 | `notification_send`（守门：限流 + 等级上限 + 全量审计） |

### 三条链路

| 链路 | 形态 | 可靠性 |
|---|---|---|
| **AI 查/办通知** | 你问一句「帮我过一下通知」，AI 调 tools 拉取、确认、回复 | ★★★ 最可靠（AI 是拉模型） |
| **AI 触发 → 人收推送** | AI 建任务/发评论@人 → events → 通知引擎 → 手机/桌面系统推送 | ★★★ 零额外开发，天然成立 |
| **系统 → AI 在线订阅** | `subscriptions/listen` 订阅 `todo://notifications` 等资源，AI 在线时近实时感知变化 | ★ 连接内有效，断开静默降级 |

### 规范基线

按 **MCP 最新规范 2026-07-28** 实现：无状态协议、`server/discover` 能力发现、
`subscriptions/listen` 订阅、MRTR 模式；桥接包 **`todomcp-mcp`**（npx 一行）让
Claude Desktop 等 stdio 客户端即装即用。详见 [docs/mcp.md](./docs/mcp.md)。

## ✨ 更多核心特性

- **协作待办**：共享清单 / 看板拖拽 / 任务分配与流转（todo · doing · review · done 四态）
- **实时同步**：一端改动，全端秒级一致；断线重连自动补齐（events 游标机制）
- **通知系统**：三级分级（🔴🟠⚪）、等级决定推送、@提及「收到」确认闭环、按任务关注/静音
- **讨论区**：评论 + 一级回复 + @提及，评论按任务状态分段沉淀
- **任务能力**：子任务、重复任务（计划时间推进）、附件、智能视图（今天/我负责的/已逾期）、Ctrl+K 搜索
- **双模式认证**：本地账号体系可独立运行；可选接入统一用户中心 SSO
- **P1 在路上**：日历 / 甘特（依赖·级联·关键路径·基线）/ 工作区 Wiki / 仪表盘 / 任务模板

## 🏗 技术栈速览

| 层 | 选型 |
|---|---|
| 后端 | Node 20 + TypeScript + Fastify · Drizzle + PostgreSQL 16 · pg-boss · Socket.IO |
| Web | Vite + React 18 + shadcn/ui + TanStack Query（兼作桌面/PWA 载体） |
| 移动端 | Expo（React Native，SDK 57）+ Expo Push |
| PC 桌面 | Tauri 2（复用 Web 构建产物） |
| MCP | @modelcontextprotocol/sdk（2026-07-28 规范基线） |
| 工程 | pnpm monorepo · vitest + Playwright · oxlint/oxfmt · Docker Compose 一体化部署 |

## 📚 文档（单一事实源）

| 文档 | 内容 |
|---|---|
| [docs/PLAN.md](./docs/PLAN.md) | 项目总纲：功能分级、架构、ADR 决策记录 |
| [docs/backend.md](./docs/backend.md) | 后端实现：双模式认证、数据模型、通知引擎、部署 |
| [docs/web.md](./docs/web.md) · [desktop.md](./docs/desktop.md) · [mobile.md](./docs/mobile.md) | 各端实现指南 |
| [docs/mcp.md](./docs/mcp.md) | **MCP：规范基线、工具集、通知暴露面、订阅** |
| [docs/ui.md](./docs/ui.md) | UI 风格与主题 token 系统 |
| [docs/flows.md](./docs/flows.md) | 14 张 Mermaid 流程图 |
| [docs/conventions.md](./docs/conventions.md) | 工程规范：Git / TDD / AI 使用 / 测试 |
| [AGENTS.md](./AGENTS.md) | AI 协作约定（AI 参与开发必读） |

## 🚀 快速开始

环境要求：Node 20+ / pnpm / Docker

```bash
# 1. 配置环境变量
cp .env.example .env

# 2. 起开发数据库（PostgreSQL）
docker compose -f deploy/docker-compose.dev.yml up -d

# 3. 安装依赖并启动（脚手架落地后生效）
pnpm install
pnpm dev
```

生产部署（独立 VPS，一条命令拉起 PG + 后端 + Web 网关，Caddy 自动 HTTPS）：

```bash
cd deploy && docker compose --env-file ../.env -f docker-compose.yml up -d --build
```

接入 AI（MCP Server 上线后）：

```bash
# Claude Desktop 等 stdio 客户端，一行桥接
npx todomcp-mcp --url https://todo.你的域名/mcp --token <你的token>
```

## 📌 项目状态

规格与文档已完备（七轮需求对齐定稿），当前处于 **A 阶段（脚手架 + 契约冻结）**前夕。
路线图与里程碑见 [docs/PLAN.md](./docs/PLAN.md) §9。

## 许可

私有项目，保留所有权利。
