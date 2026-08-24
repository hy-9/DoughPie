# 豆排排 · 流程图集（整体 + 各功能）

> 拆分自 PLAN.md v5 配套文档（2026-08）。全部使用 Mermaid，GitHub/VS Code 直接渲染。
> 规格以 [PLAN.md](./PLAN.md) 为准；流程图变更需与对应章节同步。

## 目录

1. [整体架构](#1-整体架构)
2. [双模式认证流程](#2-双模式认证流程)
3. [任务状态机](#3-任务状态机)
4. [任务写路径与实时同步](#4-任务写路径与实时同步)
5. [通知系统全流程](#5-通知系统全流程)
6. [提及确认闭环](#6-提及确认闭环)
7. [看板拖拽流转](#7-看板拖拽流转)
8. [重复任务生成](#8-重复任务生成)
9. [提醒引擎与后台任务](#9-提醒引擎与后台任务)
10. [工作区邀请流程](#10-工作区邀请流程)
11. [附件上传](#11-附件上传)
12. [MCP 调用链路](#12-mcp-调用链路)
13. [甘特级联改期（P1）](#13-甘特级联改期p1)
14. [交付流程（工作包依赖）](#14-交付流程工作包依赖)

---

## 1. 整体架构

```mermaid
flowchart TB
    subgraph 客户端
        WEB["Web（React SPA / PWA）"]
        DESK["PC 桌面（Tauri 壳，复用 Web 产物）"]
        MOB["移动端（Expo RN）"]
        AI["AI 助手（Claude 等）"]
    end

    subgraph 后端["豆排排 后端（Node/Fastify 单进程 :8699）"]
        API["REST /api/v1<br/>routes → services"]
        WS["Socket.IO<br/>workspace 房间"]
        MCP["MCP Server /mcp"]
        JOBS["pg-boss<br/>提醒扫描/每日汇总/UC 治理轮询"]
        ENGINE["通知引擎<br/>（events 第四消费方）"]
    end

    DB[("PostgreSQL 16<br/>业务表 + events + notifications")]
    DISK[("本地磁盘 uploads<br/>附件")]
    UC["统一用户中心 UC（可选）<br/>Rust/Salvo :8698"]
    EXPO["Expo Push Service"]
    WPUSH["浏览器 Push Service<br/>（web-push/VAPID）"]

    WEB <-->|"HTTPS + WSS"| API
    DESK <-->|"HTTPS + WSS"| API
    MOB <-->|"HTTPS + WSS"| API
    WEB <--> WS
    DESK <--> WS
    MOB <--> WS
    AI <-->|"MCP（Streamable HTTP / stdio 桥接）"| MCP
    API --> DB
    WS --> DB
    MCP --> API
    API --> DISK
    JOBS --> DB
    API --> ENGINE
    JOBS --> ENGINE
    ENGINE -->|"🔴 系统推送"| EXPO
    ENGINE -->|"🔴 系统推送"| WPUSH
    ENGINE -->|"socket 事件"| DESK
    EXPO -->|"APNs / FCM"| MOB
    WPUSH -->|"浏览器弹窗（页面可关）"| WEB
    API <-->|"SSO 授权码 / 治理轮询 / 心跳上报"| UC
```

---

## 2. 双模式认证流程

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户浏览器
    participant S as 豆排排 后端
    participant UC as 统一用户中心（可选）

    Note over U,S: 通道一：本地登录
    U->>S: POST /auth/login（username+password）
    S->>S: argon2 校验 + 防爆破计数（10 次锁 15 分钟）
    S-->>U: 自签 access（30min）+ refresh（30d，轮换）

    Note over U,UC: 通道二：UC SSO 首登（先问后建）
    U->>S: GET /auth/sso/start
    S-->>U: 302 跳 UC /oauth/authorize（PKCE S256）
    U->>UC: 登录（已有 SSO 会话则秒过）
    UC-->>U: 302 回跳 /auth/callback?code&state
    U->>S: POST /auth/sso/token（code+verifier+state）
    S->>UC: POST /oauth/token（注入 client_id/secret）
    UC-->>S: UC 双 Token
    S->>UC: GET /oauth/userinfo
    UC-->>S: 返回 id/username/role
    alt identities 已有绑定
        S-->>U: 直接发自签双 Token，登录完成
    else 无绑定
        S-->>U: pending_sso 票据（5 分钟一次性）
        alt 关联已有账号
            U->>S: 输入本地 username+password
            S->>S: 校验（计入防爆破）→ 绑定 identity
        else 创建新账号
            U->>S: 确认用户名（冲突加后缀）
            S->>S: 建号 + 绑定 identity
        end
        S-->>U: 发自签双 Token，登录完成
    end
```

---

## 3. 任务状态机

```mermaid
stateDiagram-v2
    [*] --> todo: 创建任务
    todo --> doing: 开始处理
    doing --> review: 提交待验收
    review --> done: 验收通过
    review --> doing: 验收驳回
    todo --> done: 直接完成（合法）
    doing --> done: 直接完成（合法）
    done --> todo: 重开
    note right of review
        P0 枚举预埋四态、UI 三列渲染
        （review 归入进行中列 + 徽章）
        P1 开第四列与流转 UI
    end note
    note right of done
        仅 done 触发重复任务下一实例
        完成记录 completed_at/completed_by
    end note
```

---

## 4. 任务写路径与实时同步

```mermaid
sequenceDiagram
    autonumber
    participant A as 端 A（发起者）
    participant S as 后端
    participant DB as PostgreSQL
    participant B as 端 B（协作方）

    A->>A: 乐观更新本地 UI（TanStack Query 缓存）
    A->>S: PATCH /tasks/:id（If-Match: version=7）
    S->>DB: 事务开始
    S->>DB: UPDATE ... WHERE version=7
    alt 版本匹配
        S->>DB: 写 events（游标 id 全局递增）
        S->>DB: 提交事务
        S-->>A: 200（version=8）
        S->>B: Socket 广播 event → B 失效对应 Query 缓存 → 自动重渲染
    else 版本冲突
        S->>DB: 回滚
        S-->>A: 409 Conflict
        A->>S: 重新拉取最新数据
        S-->>A: 200（最新 version）
        A->>A: 回滚乐观更新 + 提示「已被 XX 修改」
    end
    Note over B,S: 断线重连：携带 lastEventId → GET /events?cursor=N → 增量补齐（正确性只依赖游标）
```

---

## 5. 通知系统全流程

```mermaid
flowchart TB
    E["events 新事件<br/>（task.*/comment.*/mention.*）"] --> F{"通知引擎<br/>按类型匹配接收人"}
    F -->|"progress（推进）"| W{"遍历任务关注者"}
    W -->|"notify_mode=all"| GEN["生成通知（发起者本人除外）"]
    W -->|"mentions_only / muted"| SKIP["跳过"]
    F -->|"mention / assigned"| GEN
    J["pg-boss 每分钟扫描<br/>remind_at 到期"] --> GEN
    J2["pg-boss 每日 9:00<br/>未完成汇总"] --> GEN
    GEN --> DEDUP{"notifications 去重<br/>（同任务同窗口）"}
    DEDUP -->|重复| SKIP
    DEDUP --> LVL{"等级 → 推送策略"}
    LVL -->|"🔴 高"| PUSH["系统推送 + 站内"]
    LVL -->|"🟠 中"| MID["站内 + 推送可选"]
    LVL -->|"⚪ 低"| INAPP["仅站内"]
    PUSH --> CH1["Expo Push → 手机（App 可杀）"]
    PUSH --> CH2["web-push → 浏览器（页面可关）"]
    PUSH --> CH3["socket → 桌面本地通知（需在线）"]
    MID --> CH4["socket → 铃铛角标 / toast"]
    INAPP --> CH4
    CH1 --> READ["已读/确认状态变更"]
    CH2 --> READ
    CH3 --> READ
    CH4 --> READ
    READ --> SYNC["写 events → 全端同步已读/确认状态"]
```

---

## 6. 提及确认闭环

```mermaid
sequenceDiagram
    autonumber
    participant A as A（@发起者）
    participant S as 后端
    participant B as B（被@者）

    A->>S: POST /comments（内容含 @B @C）
    S->>S: 事务：写 comment（state_at_comment）+ events + mention 通知（🔴 待确认）
    S-->>B: 三通道触达（Expo/web-push/桌面/站内）
    B->>B: 点通知 → 深链进任务详情（锚定评论楼层）
    Note over B: progress 类通知此刻自动已读<br/>mention 类必须手动确认
    B->>S: 点「收到」（mention_ack）
    S->>S: 写 ack_at + events（mention.acked）
    S-->>A: 广播：评论区 chips 更新「@B✅已确认 14:32」，进度 1/2
    opt C 超过 24h 未确认
        A->>S: 点「再提醒」（同一人对同一提及 24h 限一次）
        S-->>C: 再次推送 mention 通知
    end
```

---

## 7. 看板拖拽流转

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as 前端（dnd-kit）
    participant S as 后端
    participant O as 其他端

    U->>FE: 拖拽卡片：todo 列 → doing 列
    FE->>FE: 乐观更新（卡片立即移动）
    FE->>S: PATCH /tasks/:id（status+sort_order，If-Match: version）
    alt 成功
        S-->>FE: 200
        S-->>O: 广播 event → 其他端卡片同步移动
    else 409 冲突
        S-->>FE: 409
        FE->>S: 重新拉取
        S-->>FE: 最新数据
        FE->>U: 卡片回到实际位置 + 提示「已被 XX 移动」
    end
```

---

## 8. 重复任务生成

```mermaid
flowchart LR
    C["用户勾选完成"] --> Q{"status=done<br/>且有 recurrence？"}
    Q -->|"否"| END1["仅标记完成"]
    Q -->|"是"| T["同一事务内"]
    T --> T1["本实例 → done<br/>记 completed_at/by"]
    T --> T2["生成下一实例<br/>due_at 推进一个周期<br/>继承标题/负责人/规则"]
    T2 --> CLAMP{"monthly 且月末？"}
    CLAMP -->|"1/31 → 2 月"| C1["clamp 到 28/29 日"]
    CLAMP -->|"常规"| C2["直接推进"]
    C1 --> BC["广播两条 events<br/>（completed + created）"]
    C2 --> BC
    BC --> V["各端自动出现新任务"]
    Note1["注意：review 态不触发生成<br/>到点不自动生成（防逾期堆积）"] -.- Q
```

---

## 9. 提醒引擎与后台任务

```mermaid
flowchart LR
    CRON1["pg-boss 每分钟"] --> SCAN["扫描 tasks<br/>remind_at ≤ now<br/>且 status ≠ done"]
    SCAN --> DEDUP{"同任务同窗口已发？"}
    DEDUP -->|"是"| SKIP["跳过"]
    DEDUP -->|"否"| JOB["投递一次性 job"]
    JOB --> FAN["按等级扇出<br/>Expo / web-push / 桌面 / 站内"]
    CRON2["pg-boss cron 每日 9:00"] --> SUM["生成未完成汇总<br/>排除 mute_incomplete 任务"]
    SUM --> FAN
    CRON3["后台 60s 轮询"] --> FL["UC force-logout-ts<br/>iat 早于时间戳 → 吊销本地会话"]
    CRON4["定时 5 分钟（P1）"] --> HB["批量上报 UC 心跳<br/>（仅 uc 绑定用户）"]
```

---

## 10. 工作区邀请流程

```mermaid
flowchart TB
    O["owner 生成邀请链接<br/>默认 member（可选 viewer）<br/>7 天有效/不限次/可作废"] --> L["链接分发给新人"]
    L --> N{"新人点击"}
    N -->|"未注册"| R["本地注册页建号"]
    N -->|"已注册未登录"| LG["登录（本地或 SSO）"]
    N -->|"已登录"| J["POST /invites/:code/accept"]
    R --> J
    LG --> J
    J --> V{"校验：存在/未过期/未作废？"}
    V -->|"否"| ERR["提示链接失效"]
    V -->|"是"| M["写入 memberships<br/>角色=链接指定"]
    M --> E["events 广播<br/>成员列表全端刷新"]
    E --> W["进入工作区看板"]
```

---

## 11. 附件上传

```mermaid
flowchart LR
    U["选择文件<br/>web 拖拽 / 移动拍照相册"] --> V{"前端预检<br/>白名单 + ≤10MB + ≤10 个/任务"}
    V -->|"不合规"| ERR["提示具体原因"]
    V -->|"合规"| UP["POST /attachments（multipart）"]
    UP --> CHK{"服务端复检<br/>（禁可执行文件）"}
    CHK -->|"拒绝"| ERR
    CHK -->|"通过"| SAVE["落盘 uploads/ws_id/yyyymm/<br/>图片 sharp 生成缩略图"]
    SAVE --> META["元数据入库<br/>entity_type: task/wiki_doc/workspace"]
    META --> EV["events 广播<br/>附件卡片全端可见"]
```

---

## 12. MCP 调用链路

```mermaid
sequenceDiagram
    autonumber
    participant H as 用户（对 Claude 说话）
    participant AI as Claude
    participant M as 豆排排 MCP Server
    participant S as service 层
    participant B as 李四（手机）

    H->>AI: 「给李四建个任务：周五前交设计稿，高优先级」
    AI->>M: task_create（Bearer mcp_token）
    M->>M: 验 token + 角色（viewer 只读）
    M->>S: 复用 taskService.create（同一套业务逻辑）
    S->>S: 事务：tasks + events + 李四的 assigned 通知（🔴）
    S-->>B: Expo Push → 系统通知栏
    M-->>AI: 返回任务 JSON
    AI-->>H: 「已建好，李四会收到推送」
    Note over AI,M: AI 侧通知能力：notification_list / mention_ack /<br/>subscriptions/listen 在线订阅 resources/updated
```

---

## 13. 甘特级联改期（P1）

```mermaid
flowchart TB
    D["拖动甘特条<br/>改 start_at/due_at"] --> C["沿依赖 DAG 收集后继任务"]
    C --> CHK{"后继 start < 本任务 due？"}
    CHK -->|"否"| OK["仅本任务改期"]
    CHK -->|"是"| SHIFT["后继自动顺延<br/>（逐层传播）"]
    SHIFT --> BATCH["全部变更记 batch_id<br/>一次事务提交"]
    OK --> BATCH
    BATCH --> EV["广播批量 events"]
    EV --> UNDO{"用户点「撤销本次级联」？"}
    UNDO -->|"是"| REV["按 batch_id 整批回滚<br/>广播反向 events"]
    UNDO -->|"否"| DONE["完成"]
    Note1["依赖建边时 DFS 防循环<br/>成环 409 拒绝"] -.- C
```

---

## 14. 交付流程（工作包依赖）

```mermaid
flowchart LR
    A["A 合同冻结"] --> B1["B1 后端·认证"]
    A --> B2["B2 后端·领域"]
    A --> B3["B3 Web·骨架"]
    A --> B4["B4 基建"]
    B1 --> C["C 联调<br/>检查点①"]
    B2 --> C
    B3 --> C
    B4 --> C
    C --> D["D 看板+实时层<br/>检查点②双设备互拖"]
    D --> E["E 通知+推送<br/>检查点③真机"]
    E --> F["F 附件"]
    F --> P0{{"P0 完成线（17 项 ~3.5 周）"}}
    P0 --> PA["P1-A 通知增强"]
    P0 --> PB["P1-B 状态机"]
    P0 --> PC["P1-C 视图扩展"]
    P0 --> PD["P1-D Wiki"]
    P0 --> PE["P1-E 仪表盘"]
    P0 --> PF["P1-F 甘特 G1→G5（长杆）"]
    P0 --> PG["P1-G 协作收尾"]
    P0 --> PH["P1-H MCP/桌面"]
    PA --> H["H 部署<br/>检查点④恢复演练"]
    PB --> H
    PC --> H
    PD --> H
    PE --> H
    PF --> H
    PG --> H
    PH --> H
```
