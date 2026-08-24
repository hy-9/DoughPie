import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit 配置：由 src/models/schema.ts 生成 SQL 迁移到 ./drizzle（入库）。
 * dbCredentials 仅 generate/push 等命令需要；本地默认开发库，生产经 DATABASE_URL 注入。
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/models/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://doughpie:doughpie_dev@localhost:5432/doughpie",
  },
});
