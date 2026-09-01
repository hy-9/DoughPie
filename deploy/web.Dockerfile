# ==========================================================================
# Web 网关镜像（多阶段：构建 SPA 静态产物 → Caddy 伺服 + 反向代理）
# 构建（仓库根目录）：docker build -f deploy/web.Dockerfile -t doughpie-web .
# ==========================================================================

# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm -r --filter @doughpie/shared --filter @doughpie/api-client --filter @doughpie/web build

# ---------- 运行阶段（Caddy 自动 HTTPS） ----------
FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
