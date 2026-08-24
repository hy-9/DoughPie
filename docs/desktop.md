# 豆排排 · PC 桌面端专项文档

> 拆分自 PLAN.md v4（2026-08）。产品规格与跨端架构以 [PLAN.md](./PLAN.md) 为 SSOT；
> 本文档是 PC 桌面端（apps/desktop，Tauri 壳）实现指南。桌面端 UI = apps/web 构建产物，
> 本文档只覆盖壳层与桌面增量能力。

---

## 1. 形态与栈

- **Tauri 2（当前 2.11.x）**，壳内加载 `apps/web` 构建产物；**几乎不写 Rust**
- 插件：`tauri-plugin-notification`（本地通知）、`tauri-plugin-autostart`（开机自启）、
  `tauri-plugin-global-shortcut`（全局快捷键）、`tauri-plugin-updater`（自动更新）、单实例插件
- 选 Tauri 不选 Electron：安装包 ~10MB vs ~150MB，内存低一个量级

## 2. 桌面增量功能（P1，桌面端价值所在）

| 功能 | 实现 |
|---|---|
| 托盘常驻 | 关闭窗口→最小化到托盘（非退出）；托盘菜单：打开/新建任务/退出 |
| 桌面系统通知 | socket 收到高等级事件 → `tauri-plugin-notification` 本地通知弹出（点击深链到任务） |
| 全局快捷键 | 全局唤起新建任务窗口（默认 Ctrl+Shift+T，可改） |
| 开机自启 | autostart 插件，设置页开关（默认关） |
| 自动更新 | tauri-updater + GitHub Releases；启动时静默检查 |

## 3. 推送策略（已知限制与对策）

- **限制**：Tauri 应用**完全退出后收不到任何远程推送**（不是常驻推送进程）
- **对策**：托盘常驻 + socket 保活——前台/托盘状态下经 socket 收事件、本地通知弹出
- **保底**：用户彻底退出时，**移动端（Expo Push）是推送保底渠道**——这是移动端选型时的既定分工，接受

## 4. 壳层注意项

- WebView 差异：Windows WebView2 / macOS WKWebView / Linux WebKitGTK——锁定现代 CSS 子集，
  shadcn 生态默认兼容良好；构建后三平台各跑一遍冒烟
- 同源与代理：生产环境壳内直接访问 https 域名（无 Vite 代理）；开发期指 `http://localhost:5173`
- token 存储：复用 web 的 localStorage 方案（WebView 持久化）；socket 断线重连+游标补齐与 web 一致
- CSP：壳内收紧 CSP 白名单（仅允许同源 API 与 UC 域名）

## 5. 工作包映射（详见 PLAN.md §9）

G2 桌面壳（托盘/通知/快捷键/自启/更新）｜P1-H 的桌面增量部分

## 6. 桌面端风险

| 风险 | 对策 |
|---|---|
| 完全退出后无远程推送 | 托盘常驻+socket 保活；移动端推送保底（已定分工） |
| WebView 差异导致样式/行为不一致 | 现代 CSS 子集 + 三平台冒烟 |
| 自动更新签名配置 | updater 公钥随包发布，私钥入 CI secrets；H 阶段验证更新链路 |
