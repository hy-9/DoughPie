# 豆排排 · 工程规范手册

> 拆分自 PLAN.md v5 配套文档（2026-08）。本手册是**人（评审者）与 AI（实现者）共同遵守的工程纪律**，
> 与 [PLAN.md](./PLAN.md)（产品规格 SSOT）配套使用。AGENTS.md（M0 产出）引用本手册。
> 带 ⚖️ 标记的条目为待最终确认的开放细节（见文末 §7）。

---

## 1. 仓库与 Git 规范

### 1.1 单仓结构（monorepo，唯一主仓）

```
doughpie/                        # GitHub 私有仓
├── apps/
│   ├── server/                 # 后端 Fastify → backend.md
│   ├── web/                    # Web React（兼 Tauri/PWA 载体）→ web.md
│   ├── mobile/                 # 移动端 Expo RN → mobile.md
│   └── desktop/                # PC 桌面 Tauri 壳 → desktop.md
├── packages/
│   ├── shared/                 # ★ zod 契约/枚举/事件目录/通知矩阵/文案常量（全端单一事实源）
│   ├── api-client/             # 类型安全 client + socket 封装 + 单飞刷新
│   └── mcp-bridge/             # todomcp-mcp：stdio→HTTP 桥接（仓内 pnpm publish 发 npm）
├── docs/                       # SSOT 文档群（PLAN/平台专项/flows/本手册）
├── deploy/                     # docker-compose.yml、Caddyfile、备份/恢复脚本
├── .github/workflows/          # CI 门禁 + Release 流水线
├── AGENTS.md                   # AI 协作约定（M0 产出，引用本手册）
├── pnpm-workspace.yaml
├── .gitattributes              # 统一 LF
└── .gitignore                  # node_modules/dist/uploads/keys/.env/*.log/target/android/ios
```

- **单仓理由**：契约共享原子提交（改 events 类型四端同改一次 commit）；AI 单上下文可见；
  20 人工具无独立发版需求
- **UC 仓库不动**：纯 HTTP 契约对接，PLAN.md 记录对接时的 UC 代码基线 commit hash 便于追溯
- **不入库**：`uploads/`、`keys/`、`.env`、Expo prebuild 原生工程（CNG 可重建）、构建产物
- **代码异地备份**：VPS 加 cron 每日 `git fetch --mirror`（与 pg_dump/uploads 备份配套）

### 1.2 分支策略（混合，对应 ADR D28）

| 阶段 | 策略 | 细则 |
|---|---|---|
| 骨架期 → P0 早期 | AI 直推 main | main 不设保护；CI 红 = 工作包不算完 |
| P0 中后期起 | main 保护 + feature 分支 + PR | AI 自开 PR（标题/描述/DoD 勾选自动生成），人 review 后 squash merge |

- 分支命名：`feat/<域>-<简述>`（如 `feat/notify-mention-ack`）、`fix/...`、`chore/...`、`test/...`、`docs/...`
- 提交规范：**Conventional Commits**：`feat(server): 提及确认接口`、`fix(web): 看板 409 回滚`
- 里程碑 tag：`m0-scaffold`、`p0-rc`、`v1.0.0`；**全端共用一条版本线**（不分端独立版本号）
- GitHub Releases：桌面三平台安装包 + Android APK（tag `v*` 触发流水线）；
  iOS 走 EAS → TestFlight，不进 Releases

### 1.3 CI 流水线

```
push/PR → pnpm --filter="...[origin/main]"（只跑受影响包）
  ├─ shared:   tsc + 契约单测
  ├─ server:   lint + tsc + 单测 +（PR 起 PG 容器跑集成测试）
  ├─ web:      lint + tsc + build
  ├─ mobile:   tsc（打包交给 EAS）
  └─ desktop:  tsc（安装包交给 Release 流水线）
nightly → 全量 + pnpm audit + Playwright 冒烟
tag v*  → Release 流水线：桌面安装包 + APK → GitHub Releases
```

## 2. TDD 开发规范

### 2.1 分级适用（不是一切都 TDD）

| 级别 | 对象 | 要求 |
|---|---|---|
| **L1 强制红-绿-重构** | 纯逻辑/算法：重复任务引擎（月末 clamp/周期推进）、排序间隙值、依赖防环（DFS）、级联改期、关键路径、权限矩阵、防爆破计数、通知去重 | **先写失败测试（红）→ 实现到绿 → 重构**；测试先行单独提交（`test(scope): ...`），实现随后 |
| **L2 测试先行** | service 层业务流：注册/登录/绑定/邀请/评论@/提及确认/任务流转/通知扇出 | 测试与实现同工作包交付；**测试断言从 PLAN.md 规格推导**（军规 4），不从实现反推 |
| **L3 实现后补测** | routes 层（集成测试）、Web 关键交互组件（看板拖拽、乐观更新回滚、确认 chips） | 工作包 DoD 内补齐 |
| **L4 不强制** | 纯展示组件、配置文件、一次性脚本 | 不测 |

### 2.2 AI 的 TDD 节奏（L1/L2 必须按此执行）

```
① AI 从规格（PLAN.md 对应章节）写出失败测试用例集
② 人确认测试断言（关键闸：防「测试镜像实现假设」的同源偏差）
③ AI 实现到测试全绿（自跑自修，禁止改测试迁就实现）
④ 重构（保持绿），提交
```

- 规格变更必须先改 PLAN.md → 再改测试 → 再改实现；**禁止以改测试的方式让失败消失**
- L1 模块的测试用例表在 PLAN.md/规格评审时确认（如重复任务的月末/时区/interval/by_weekday 矩阵）

## 3. 项目规范

### 3.1 语言与风格

- **中文**：注释、提交信息（描述部分）、文档、测试描述、AGENTS.md；**英文**：标识符、分支名、包名
- TypeScript `strict`；禁止 `any`（确需使用必须同行注释理由）；**显式 import**（禁用自动导入插件，对齐用户习惯）
- 格式化/lint：**oxlint + oxfmt**（Rust 实现，与 userSystemUi 同族）；
  提交时 husky + lint-staged 自动执行
- 命名：文件 kebab-case、组件 PascalCase、函数/变量 camelCase、类型 PascalCase、常量 SCREAMING_SNAKE

### 3.2 分层纪律

- routes 薄（解析+校验+调 service+渲染）；**业务逻辑只许在 services/**；HTTP 与 MCP 都是 service 的薄适配器
- `packages/shared` **只放契约**（zod/枚举/类型/常量），禁止放实现逻辑
- 依赖方向单向：apps → packages；packages 之间 shared ← api-client（禁止反向/循环）
- 错误处理：扁平 `{code, message}` + 标准 HTTP 码（与 UC 风格一致）；客户端统一 ApiError

### 3.3 依赖与安全

- 新增依赖需一行理由（体积/维护度/许可）；锁文件必须提交；`pnpm audit` 进 CI（nightly）
- 密钥/证书只进 `.env` 与 CI secrets；**任何代码、测试、文档中禁止出现真实密钥**
- 日志：pino，中文消息，request-id 贯穿；禁止打印 token/密码全文

### 3.4 时间戳纪律（DB 时钟单源）

- **`updated_at` 一律 DB 时钟**：insert 靠 schema `defaultNow()`；update 写 `` sql`now()` ``，
  **禁止 JS 侧 `new Date()` 赋值**
- 理由：应用进程与 PG 可能不同时钟（Windows 开发机 WSL2 漂移高发），双源写入会让
  跨行时间戳比较偶发失真（2026-09 因此产生 flaky 测试事故，已全仓统一修复）
- 业务时间字段（`completed_at`/`deleted_at` 等）JS 单源写入不受此限；
  一旦出现跨时钟源比较需求，即升级为 DB 时钟

## 4. AI 使用规范（本项目 AI 全量实现，本节即生产纪律）

### 4.1 开工仪式（每个 AI 会话/工作包开始前必做）

1. 读 `AGENTS.md` + 本手册
2. 读 PLAN.md 对应章节 + 对应平台专项文档（backend/web/desktop/mobile/mcp）
3. 确认当前工作包的**规格引用 + DoD 清单**；不跨包作业

### 4.2 作业纪律

- **合同先行**：改 `packages/shared` 契约 → 必须先改 PLAN.md/专项文档，走显式变更说明
- **门禁自修复**：完成后自跑 lint/tsc/test/build **到全绿**才算完；禁止“差不多绿了”“应该能过”
- **禁止行为清单**：
  - 禁止 `--no-verify` 绕过钩子；禁止跳过/删除失败测试；禁止改测试迁就实现
  - 禁止沉默降级：找不到的 API/SDK 行为必须先 spike 验证，**禁止凭记忆编造**
  - 禁止引入第二套 UI 库/状态库/HTTP 库（单一方案纪律，对齐用户 userSystemUi 传统）
  - 禁止硬编码色值：UI 组件只消费语义 token（ui.md §2，主题可切换的前提）
  - 阶段二起禁止直推 main（必须 PR）
- **依赖锁版本**：新 SDK 集成点先写 10 行 spike 验证再铺开（防幻觉 API）

### 4.3 汇报规范（每个工作包完成时）

```
① DoD 逐条勾选（原文引用，不得概括）
② 门禁输出（lint/tsc/test/build 四条命令的结果摘要）
③ 变更文件列表（新增/修改/删除）
④ 偏差说明：与规格的任何出入 + 原因 + 建议
⑤ 待人工验收点：需要人做什么（检查点/真机/账号）
```

- **诚实红线**：虚构验证结果 = 本项目最严重事故；不确定就标注「未验证，需要人工确认」

## 5. 测试规范

### 5.1 测试金字塔与分层要求

| 层 | 范围 | 工具 | 要求 |
|---|---|---|---|
| 单元测试 | shared 契约（zod 边界/枚举/纯函数）、server services 业务流、L1 算法 | vitest | shared/services 核心模块 **≥80% 行覆盖（CI 拦截）**；毫秒级 |
| API 集成测试 | routes + service + 真实 PG | vitest + Fastify inject | 每业务流至少 1 条；PG 用 docker compose 测试实例，CI 用 services 容器 |
| 组件测试 | Web 关键交互（看板拖拽/乐观更新回滚/提及确认 chips/通知分组） | vitest + @testing-library | 覆盖关键交互，不追求全量 |
| E2E 冒烟 | 3 条核心路径：①注册登录→建任务→完成→他端可见 ②提及→确认闭环 ③邀请链接→入区 | Playwright |  nightly + 检查点验收前必过 |
| 移动端 | 关键逻辑单测（api-client/同步逻辑） | vitest | 不做 RN UI 测试 |

### 5.2 组织与命名

- 测试文件就近放置（colocated）：`foo.ts` ↔ `foo.test.ts`；E2E 在顶层 `e2e/`
- describe/it 描述用**中文**（断言即规格文档）：`it("1月31日月重复应 clamp 到 2 月 28 日")`
- 测试数据：factory 模式（`tests/factories.ts` 每包一份）；禁止共享可变 fixture；
  集成测试每用例独立事务或清库
- 禁止访问真实网络/真实 UC/真实推送服务（一律 mock/stub；集成测试只打真实 PG）

### 5.3 与验收的关系

- CI 绿 ≠ 完成；完成 = CI 绿 + DoD 勾选 + 检查点人工验收
- 检查点②③④（双设备互拖/真机推送/恢复演练）是**人工测试**，AI 提供操作清单与预期结果表

## 6. 文档规范

- 文档即代码：规格变更 = 改 docs + 改代码同一 PR；PLAN.md 保持 SSOT
- ADR：每个非显然决策追加一行（编号递增，不修改历史）
- flows.md 图与规格同步更新；Mermaid 语法变更后需能渲染（CI 可加 mermaid-cli 校验，可选）

## 7. 已确认的开放细节（2026-08 定稿）

| # | 事项 | 定稿 |
|---|---|---|
| 1 | lint/格式化 | **oxlint + oxfmt** |
| 2 | 测试文件位置 | **就近 colocated**（`*.test.ts`），E2E 顶层 `e2e/` |
| 3 | 覆盖率门槛 | **shared/services 核心模块 ≥80% 行覆盖，CI 拦截**；UI 不设限 |
| 4 | 提交信息语言 | **英文前缀 + 中文描述**（`feat(server): 提及确认接口`） |
| 5 | PR 评审深度 | **抽查 + 检查点兜底**：规格/测试断言重点看，实现扫 diff，门禁绿即合 |
