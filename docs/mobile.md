# 豆排排 · 移动端专项文档

> 拆分自 PLAN.md v4（2026-08）。产品规格与跨端架构以 [PLAN.md](./PLAN.md) 为 SSOT；
> 本文档是移动端（apps/mobile，Expo React Native）实现指南。

---

## 1. 选型与证据（2026-08 核查）

**选型：Expo（React Native，SDK 57）+ expo-notifications。**

- Tauri v2.11.5：官方 28 个插件中**无远程推送插件**；npm `@tauri-apps/plugin-push` 不存在
- Expo SDK 57 活跃迭代；Expo Push 免证书免费；EAS 云构建免 macOS；expo-updates OTA 热修
- 决定性因素：提醒推送是 P0；Expo 在推送链路的可靠性与实现成本优势

## 2. 栈与共享

- Expo SDK 57 + Expo Router + React Native
- 复用 `packages/shared`（zod schema/枚举/文案常量）与 `packages/api-client`（REST/socket/单飞刷新）
- token 存 `expo-secure-store`（非 AsyncStorage）
- 组件：RN 原生 + 少量 tamagui/nativewind（选型在 A 阶段冻结；不与 web 共享 UI 代码）

## 3. 功能范围与边界（移动端只做核心场景）

| 功能 | 移动端形态 |
|---|---|
| 清单/看板 | 看板做**横向滑动**简版（点卡片进详情改状态，不做长列拖拽） |
| 任务详情 | 完整：字段/子任务/讨论区（评论/一级回复/@/确认 chips） |
| 通知中心 | 完整：分组/三级徽标/「收到」按钮/深链 |
| 智能视图/筛选/搜索 | 完整 |
| 日历（P1） | **议程列表**（按天分组时间流，不做月网格） |
| 仪表盘（P1） | 简版卡片 |
| Wiki（P1） | **只读 + 简编** |
| 甘特 | **不做**（屏幕不现实，Web/桌面专属） |
| 实例管理页 | 不做（Web 专属） |

## 4. 推送链路（移动端的核心使命）

- `expo-notifications` 获取 Expo Push Token → 注册进 `push_tokens` 表（按设备）
- 收包处理：点击通知 → 深链进对应任务详情（与通知中心深链同路由）
- **重要约束**：Expo Go 内远程推送**不可用**——推送验收必须 dev build + TestFlight/真机
- 桌面端完全退出时，移动端是**全端推送保底**（既定分工）

## 5. 分发与验收

- 开发期：Expo Go 即扫即用
- 正式版：**iOS TestFlight（内部组免审核，≤100 人）** / **Android APK 直装**
- 外部依赖：Apple Developer 账号 $99/年（**最早办**，审核 1-2 天）；EAS 免费账号；
  iOS + Android 真机各一台
- 检查点③：两台真机分别验证推送到达与深链跳转

## 6. 附件与离线

- 附件：`expo-image-picker` 相册/拍照上传（走统一 `POST /attachments`）
- 断网：P2 只读缓存（React Query persist 顺手获得）；不做离线写入

## 7. 工作包映射（详见 PLAN.md §9）

G1 移动端（Expo 四屏：清单/看板、任务详情+讨论区、通知中心、设置；推送注册流）｜
E 阶段的 Expo Push 通道联调（检查点③）

## 8. 移动端风险

| 风险 | 对策 |
|---|---|
| 推送到达率（国内 Android 通道） | Expo 免费档对 20 人足够；不足再评估自建 FCM |
| Expo Go 无远程推送误导验收 | 推送验收一律 dev build + TestFlight（已写进检查点③） |
| Apple 账号审核周期阻塞 | 外部资源清单第一项，最早办 |
| 双前端心智（RN 与 React DOM 差异） | UI 层不复用，但 shared/api-client 全复用；由 AI 实现摊薄 |
