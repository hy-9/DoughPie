# 豆排排 · UI 实现与风格规范

> 拆分自 PLAN.md v5 配套文档（2026-08）。UI 风格与设计 token 的单一事实源；
> web/desktop/mobile 三端视觉实现均遵循本文档。冲突时以本文档为准。

---

## 1. 风格定稿（六项决策，2026-08）

| 决策点 | 定稿 |
|---|---|
| 风格方向 | **A：Linear 风**（低饱和灰阶 + 单一强调色、细分割线、扁平无影、键盘优先） |
| 品牌色 | **石墨灰 + 蓝**（slate 灰阶打底，blue 强调） |
| 详情形态 | **抽屉 + 路由双形态**：看板/列表内右侧抽屉滑出；通知深链/直接访问 URL 全页渲染（同一组件） |
| 信息密度 | **适中**：看板卡片 3 行信息、列表行高 ~40px |
| 动效 | **克制**：仅功能必需（拖拽跟手/抽屉滑入/toast 淡入），150-200ms，不引入 framer-motion |
| 字体 | **Inter + 中文系统回退**（Inter 管西文/数字，中文回落 PingFang/微软雅黑） |

## 2. 设计 token 三层架构（主题切换的根基）

```
L1 基础层 primitives    tailwind 色阶引用（slate/blue/amber/emerald/red/sky 50-950）
      ↓ 仅允许 L2 引用 L1
L2 语义层 semantic      background / foreground / card / primary / muted / border /
                        ring / destructive / success / warning
                        + 业务语义：kanban-column-bg、state-todo|doing|review|done、
                          priority-high|mid|low|none、notify-high|mid|low、
                          mention-pending|acked、chart-1..5、avatar-1..10
      ↓ 组件只消费 L2
L3 组件层 component     原则上不新建；确有需要（如 gantt-bar）才设，须登记
```

**铁律**：组件只允许消费 L2/L3 语义 token，**禁止硬编码 L1 色值**（已列入 conventions.md 禁止行为清单）——这是主题可切换的前提。

## 3. 主题系统（用户特别要求：多主题架构预留）

### 3.1 模型

- **主题 Theme** = `{ id, name, tokens: { light: {...L2 赋值}, dark: {...} } }`
- **模式 Mode** = `light | dark | system`（与主题**正交**的两个维度）
- **主题注册表** `packages/shared/theme/themes.json` —— 全端单一事实源
- **档位**：P0 内置单主题 `linear-blue`（极简蓝），设置页仅模式切换，数据结构预留 `theme_id`；
  **P2 开放主题切换器 + 新主题包**（届时可把 B 滴答风/C 卡片风做成主题包加入）

### 3.2 实现链路

| 端 | 机制 |
|---|---|
| Web/Desktop | 构建期脚本由 themes.json **生成 themes.css**（`[data-theme="x"][data-mode="dark"]{ --background: ... }`）；运行时切换 `<html data-theme data-mode>` 属性**即时生效无刷新**；shadcn 组件天然消费 CSS var |
| Mobile | ThemeProvider 读同一 themes.json → 动态生成 RN 样式变量 |
| 偏好持久化 | `user_preferences.theme_id + theme_mode`（**服务端存储，多端一致**——与仪表盘布局同机制，events 同步） |

### 3.3 新增主题流程（P2 起）

1. themes.json 增加一项（light/dark 两套 L2 赋值）
2. 构建重新生成 themes.css
3. 设置页主题选择器自动出现新主题
4. 走查关键视图（看板/详情/通知中心/仪表盘/Wiki 代码块）

### 3.4 特殊色

- **recharts 图表**：色板取 `chart-1..5` 语义 token（主题内定义，随主题切换）
- **头像色块**：username 哈希 → `avatar-1..10` 色板取色（色板随主题可调，生成逻辑不变）

## 4. 默认主题 token 表（linear-blue）

| token | light | dark |
|---|---|---|
| background | `#FFFFFF` | `#020617`（slate-950） |
| foreground | `#0F172A`（slate-900） | `#F8FAFC`（slate-50） |
| card | `#FFFFFF` | `#0F172A`（slate-900） |
| muted / muted-foreground | `#F1F5F9` / `#64748B` | `#0F172A` / `#94A3B8` |
| border | `#E2E8F0`（slate-200） | `#1E293B`（slate-800） |
| primary / primary-foreground | `#2563EB`（blue-600） / `#FFFFFF` | `#3B82F6`（blue-500） / `#FFFFFF` |
| ring | `#2563EB` | `#3B82F6` |
| kanban-column-bg | `#F1F5F9`（slate-100） | `#0F172A` |
| state-todo / doing / review / done | `#64748B` / `#3B82F6` / `#F59E0B` / `#10B981` | 同 light |
| priority-high / mid / low / none | `#EF4444` / `#F59E0B` / `#0EA5E9` / `#94A3B8` | 同 light |
| notify-high / mid / low | `#EF4444` / `#F59E0B` / `#94A3B8` | 同 light |
| mention-pending / acked | `#F59E0B` / `#10B981` | 同 light |
| destructive | `#EF4444` | `#F87171` |
| radius | `0.5rem`（rounded-lg） | 同 |

## 5. 布局蓝图（web/desktop）

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏：工作区切换 ▾ │ 搜索 Ctrl+K │ 🔔通知 │ 头像菜单           │
├──────────┬──────────────────────────────────┬────────────────┤
│ 左侧栏    │ 主区（看板/列表/日历/甘特/仪表盘） │ 详情抽屉 480px  │
│ 240px    │                                  │ （右侧滑出，    │
│ 智能视图  │                                  │  URL 可达      │
│ 清单树    │                                  │  /task/:id）   │
│ 底部设置  │                                  │                │
└──────────┴──────────────────────────────────┴────────────────┘
```

- 直接访问 `/task/:id` → 同组件全页渲染（抽屉形态的路由变体）
- 移动端：底部 tab 三栏「看板·清单 / 通知 / 我的」

## 6. 组件与动效约定

- 组件唯一源 shadcn/ui；图标 lucide；toast 用 sonner；**禁止引入第二套 UI 库**
- 圆角 `rounded-lg`（8px）为主；阴影仅浮层（弹窗/下拉/toast/抽屉）
- 动效：150-200ms ease-out；dnd-kit 拖拽跟手默认；抽屉 200ms 滑入；**不引入 framer-motion**
- 加载态：Skeleton 骨架屏；空状态：lucide 图标 + 一句话 + 主操作按钮（不做插画）

## 7. 字体与字号

```css
font-family: Inter, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
```

- 数字/时间/计数：`font-variant-numeric: tabular-nums`（对齐）
- 字号阶梯：`12`（辅助说明）/ `13`（正文基准）/ `15`（强调、卡片标题）/ `18`（页标题）/ `22`（大标题）
- 行高：正文 1.6，标题 1.3

## 8. 业务语义视觉映射

| 语义 | 视觉 |
|---|---|
| 任务四态 | todo 灰点 / doing 蓝点 / review 琥珀点+「待验收」徽章 / done 绿勾+删除线标题 |
| 优先级 | 卡片左侧 3px 色条（high 红/mid 琥珀/low 天蓝/none 无） |
| 通知等级 | 🔴🟠⚪ 圆点徽标（取 notify-* token） |
| 提及确认 | chips：`@B✅已确认14:32`（绿）/ `@D⏳待确认`（琥珀） |
| 在线状态 | 头像右下绿点（灰点=离线） |

## 9. 移动端映射

- token 同源（themes.json 共享，ThemeProvider 映射 RN 样式）
- 触控热区 ≥44px；密度比 web 宽松一档（行高 ~52px）
- 深色模式跟随系统默认（可在设置覆盖）

## 10. 检查清单（AI 实现 UI 时自检）

- [ ] 只用了语义 token（无硬编码色值）
- [ ] 深浅两模式都过一遍（对比度可读）
- [ ] 交互有键盘路径（可 Tab 到达、可 Enter 触发）
- [ ] 加载/空/错误三态都有
- [ ] 动效 ≤200ms 且可降级（prefers-reduced-motion）
