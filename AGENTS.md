# AGENTS.md — AI Agent 指导说明

> 本文件供 AI Agent 参与豆排排（DoughPie）开发时参考。**开始任何工作前必读，改动代码前先读对应 docs 章节。**
> 本项目的代码由 AI 全量实现，人负责决策与验收——本文件就是你的上岗手册。

## 项目概览

- **名称**：豆排排 / DoughPie（代号 `doughpie`；MCP 桥接包保留 `todomcp-mcp` 名）
- **类型**：AI 原生多人协作待办工具（Web / 移动端 / PC 桌面 / MCP 四端）
- **阶段**：A 阶段（脚手架 + 契约冻结）
- **语言**：中文注释优先，用户沟通使用中文；标识符、分支名、包名用英文

## 必读文档（按此顺序）

1. [docs/PLAN.md](./docs/PLAN.md) — **产品规格 SSOT**：功能分级、架构、35 条 ADR
2. [docs/conventions.md](./docs/conventions.md) — **工程规范手册**：Git / TDD / 项目规范 / AI 使用规范 / 测试规范（本文件的详本）
3. [docs/ui.md](./docs/ui.md) — UI 风格与主题 token（做任何 UI 前必读）
4. 对应平台文档：[backend.md](./docs/backend.md) / [web.md](./docs/web.md) / [desktop.md](./docs/desktop.md) / [mobile.md](./docs/mobile.md) / [mcp.md](./docs/mcp.md)
5. [docs/flows.md](./docs/flows.md) — 14 张流程图（理解数据流最快的路径）

## 技术栈与版本

| 层 | 选型 |
|---|---|
| 后端 | Node 20 + TypeScript（strict）+ Fastify · Drizzle + PostgreSQL 16 · pg-boss · Socket.IO · @node-rs/argon2 |
| Web | Vite + React 18 + shadcn/ui + TanStack Query + Zustand + dnd-kit + cmdk |
| 移动端 | Expo（RN，SDK 57）+ expo-notifications |
| 桌面 | Tauri 2（2.11.x） |
| MCP | @modelcontextprotocol/sdk（规范基线 2026-07-28，集成前先 spike） |
| 测试 | vitest（单测/集成/组件）+ Playwright（E2E 冒烟） |
| 工程 | pnpm monorepo · oxlint + oxfmt · husky + lint-staged · Docker Compose |

## 常用命令（A 阶段落地后校准）

```bash
pnpm install                              # 安装依赖
pnpm dev                                  # 开发（server :8699 + web :5173）
pnpm build / pnpm test / pnpm lint / pnpm typecheck
pnpm format                               # oxfmt
docker compose -f deploy/docker-compose.dev.yml up -d   # 开发用 PostgreSQL
```

## 代码风格（要点，全量见 conventions.md §3）

- 中文注释（解释 why 而非 what）；**显式 import**（禁用自动导入）
- TypeScript strict；禁 `any`（确需使用必须同行注释理由）
- oxlint + oxfmt（提交自动执行）；文件 kebab-case、组件 PascalCase
- Conventional Commits：**英文前缀 + 中文描述**（`feat(server): 提及确认接口`）
- 分层纪律：routes 薄 / services 厚（业务逻辑只许在 services）/ **shared 只放契约**
- **UI 禁硬编码色值**：只消费语义 token（ui.md §2，主题可切换的前提）

## 工程纪律（全量见 conventions.md）

**六条军规**：合同先行（shared 变更先改 PLAN.md）· 门禁到绿才算完 · 每包带 DoD ·
关键算法测试规格先行 · 仓库即记忆 · 评审分级

**TDD 四级**：L1 算法（重复任务/排序间隙/依赖防环/级联/关键路径/权限矩阵/防爆破）强制红-绿-重构；
L2 service 业务流测试先行；L3 routes/UI 后补；L4 不测

**AI 禁止行为**：--no-verify · 跳/删/改测试迁就实现 · 沉默降级编造 API · 引入第二套 UI/状态/HTTP 库 ·
硬编码色值 · 阶段二直推 main · 提交密钥

**汇报五段式**：DoD 勾选 → 门禁输出 → 变更文件列表 → 偏差说明 → 待人工验收点。
**诚实红线**：虚构验证结果 = 本项目最严重事故。

## 关键设计约束（易踩坑）

- **events 表一石四鸟**（断线补齐/动态流/审计/通知源）：所有业务写必须在**同一事务**内写 events
- **状态枚举四态** `{todo, doing, review, done}`：P0 UI 只渲染三列（review 归入进行中列 + 徽章）
- **通知等级决定推送**：🔴 系统推送+站内 / 🟠 站内+可选 / ⚪ 仅站内；提及永不自动已读（须点「收到」）
- **重复任务**：仅 done 触发下一实例（review 不算完成）；基准=计划时间；monthly 月末 clamp；时间全 UTC
- **乐观锁**：写操作带 `If-Match: version`，409 强制 refetch；排序冲突后写者胜
- **单进程假设**：内存限流/presence/force-logout 缓存可接受；不引 Redis
- **UC 契约以本地代码为准**（`C:\code\Rust\salvo\hello`）：`/oauth/token` 无 grant_type；心跳/用量上报是裸数组

## 工作方式

- 按 **工作包** 作业（PLAN.md §9），不跨包；每包带规格引用 + DoD 清单
- 阶段一（骨架~P0 早期）AI 直推 main，CI 必绿；P0 中后期起 main 保护 + PR 流
- 四个人工检查点：① 联调 ② 双设备互拖 ③ 真机推送 ④ 备份恢复演练——AI 提供操作清单与预期结果表

## 四条不做红线

IM 聊天 · 离线写入（CRDT）· SaaS 多租户 · 邮箱通知
