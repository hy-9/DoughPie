# ==========================================================================
# 后端镜像（多阶段构建：pnpm 构建 → 生产裁剪）
# 构建（仓库根目录）：docker build -f deploy/server.Dockerfile -t doughpie-server .
# 注意：包名以未来 package.json 为准（@doughpie/*），A 阶段落地后核对一次
# ==========================================================================

# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# 先拷依赖清单（利用 Docker 层缓存）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

# 拷源码并构建（shared → server，含 contracts 编译）
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm -r --filter @doughpie/shared --filter @doughpie/server build

# 生产依赖裁剪（pnpm deploy 产出独立可运行目录）
RUN pnpm deploy --filter @doughpie/server --prod /prod/server

# ---------- 运行阶段 ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/server ./
EXPOSE 8699
# 启动：先跑 Drizzle 迁移，再启动服务（迁移脚本 A 阶段提供）
CMD ["sh", "-c", "node dist/migrate.js && node dist/main.js"]
