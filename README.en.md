# DoughPie · 豆排排

> A tofu block that keeps your tasks in order. 🧈
> An **AI-native collaborative to-do tool** for small teams (≤20 people):
> Web / Mobile / Desktop / **MCP** — real-time sync, tiered notifications.

---

## 🎯 The Name

**豆排排 (DouPaiPai)** = tofu + "rows neatly arranged".
The task cards on a kanban board look like tofu blocks stacked in tidy rows —
plain, vivid, and instantly evocative of *getting things organized*.

**DoughPie** = dough (/doʊ/ ≈ "dou") + pie (/paɪ/ ≈ "pai").
Say "DoughPie" out loud and you're practically pronouncing 豆排排 —
and both dough and pie are food, keeping the tofu theme deliciously consistent.
Two languages, one sound, zero coincidence.

**todomcp-mcp** = the MCP bridge package keeps the project's original codename
(todo + MCP). Fitting, and nothing goes to waste.

## 🤖 MCP: AI as a First-Class Teammate

DoughPie isn't "a to-do app with MCP support" — **AI assistants are designed in as
native members of the team**. They take work, assign work, chase acknowledgments,
and report progress.

### One-line demo

```
You (to Claude): "Create a task for Li Si: deliver the design draft by Friday, high priority."
        │
Claude → task_create (MCP tool) → service layer → events → notification engine
        │
        ▼
📱 Li Si's phone instantly buzzes: "You were assigned: deliver the design draft by Friday"
```

**Li Si doesn't need Claude, or to know anything about MCP** — the AI assigns work,
and humans get notified through the ordinary push channels they already have.

### Toolsets (built on the same service layer; permissions inherit the token issuer's role)

| Category | Tools |
|---|---|
| Tasks | `task_list` / `task_create` / `task_update` / `task_complete` / `task_reopen` / `task_search` / `progress_summary` |
| Notifications | `notification_list` / `notification_mark_read` / **`mention_ack` (acknowledge)** / `mention_pending` / `comment_add` / `task_watch` / `task_unwatch` |
| On-behalf | `notification_send` (guarded: rate-limited, level-capped, fully audited) |

### Three links

| Link | How it works | Reliability |
|---|---|---|
| **AI reads & handles notifications** | Ask "catch me up on my notifications" — the AI pulls, acknowledges, and replies via tools | ★★★ Most reliable (AI is pull-driven) |
| **AI acts → humans get pushed** | AI creates tasks / comments with @mentions → events → notification engine → system push on phones & desktops | ★★★ Zero extra code, works by design |
| **System → AI live subscription** | `subscriptions/listen` on resources like `todo://notifications` — near-real-time awareness while the AI client is connected | ★ Connection-scoped, degrades silently |

### Spec baseline

Implemented against the **latest MCP spec 2026-07-28**: stateless protocol,
`server/discover`, `subscriptions/listen`, MRTR pattern. The **`todomcp-mcp`** bridge
(one `npx` command) makes stdio clients like Claude Desktop plug-and-play.
See [docs/mcp.md](./docs/mcp.md).

## ✨ More highlights

- **Collaborative tasks**: shared lists / kanban with drag-and-drop / assignment & flow (todo · doing · review · done)
- **Real-time sync**: changes propagate in seconds; offline reconnect backfills via the events cursor
- **Notification system**: three tiers (🔴🟠⚪), tier-driven push policy, @mention acknowledgment loop, per-task watch/mute
- **Discussion area**: comments + one-level replies + @mentions, archived per task state
- **Task power-ups**: subtasks, recurring tasks (schedule-based), attachments, smart views (Today / Mine / Overdue), Ctrl+K search
- **Dual-mode auth**: fully self-contained local accounts; optional SSO via a central user system
- **Coming in P1**: calendar / Gantt (dependencies, cascading, critical path, baselines) / workspace wiki / dashboards / task templates

## 🏗 Tech stack

| Layer | Choice |
|---|---|
| Backend | Node 22 + TypeScript + Fastify · Drizzle + PostgreSQL 16 · pg-boss · Socket.IO |
| Web | Vite + React 18 + shadcn/ui + TanStack Query (also powers desktop & PWA) |
| Mobile | Expo (React Native, SDK 57) + Expo Push |
| Desktop | Tauri 2 (reuses the web build) |
| MCP | @modelcontextprotocol/sdk (spec 2026-07-28) |
| Engineering | pnpm monorepo · vitest + Playwright · oxlint/oxfmt · Docker Compose all-in-one |

## 📚 Docs (single source of truth)

| Doc | Contents |
|---|---|
| [docs/PLAN.md](./docs/PLAN.md) | Master plan: feature tiers, architecture, ADRs |
| [docs/backend.md](./docs/backend.md) | Backend: dual-mode auth, data model, notification engine, deployment |
| [docs/web.md](./docs/web.md) · [desktop.md](./docs/desktop.md) · [mobile.md](./docs/mobile.md) | Platform guides |
| [docs/mcp.md](./docs/mcp.md) | **MCP: spec baseline, toolsets, notification surface, subscriptions** |
| [docs/ui.md](./docs/ui.md) | UI style & theme token system |
| [docs/flows.md](./docs/flows.md) | 14 Mermaid flow diagrams |
| [docs/conventions.md](./docs/conventions.md) | Engineering conventions: Git / TDD / AI usage / testing |
| [AGENTS.md](./AGENTS.md) | AI collaboration guide (required reading for AI agents) |

## 🚀 Quick start

Requirements: Node 22.13+ / pnpm 11 / Docker

```bash
# 1. Configure environment
cp .env.example .env

# 2. Start the dev database (PostgreSQL)
docker compose -f deploy/docker-compose.dev.yml up -d

# 3. Install & run (effective once scaffolding lands)
pnpm install
pnpm dev
```

Production (single VPS — one command brings up PG + backend + web gateway, Caddy auto-HTTPS):

```bash
cd deploy && docker compose --env-file ../.env -f docker-compose.yml up -d --build
```

Connect your AI (once the MCP server ships):

```bash
# For stdio clients like Claude Desktop — one-line bridge
npx todomcp-mcp --url https://todo.your-domain.com/mcp --token <your-token>
```

## 📌 Status

Specs and docs are complete (seven rounds of requirements alignment).
Currently at the doorstep of **Phase A (scaffolding + contract freeze)**.
Roadmap: [docs/PLAN.md](./docs/PLAN.md) §9.

## License

Private project. All rights reserved.
