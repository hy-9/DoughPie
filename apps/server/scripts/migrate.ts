import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * 程序化 migrator（pnpm -F @doughpie/server db:migrate）。
 * DATABASE_URL 未注入时回落到本地开发库；vitest globalSetup 以 TEST_DATABASE_URL 复用本脚本。
 */
const url = process.env.DATABASE_URL ?? "postgres://doughpie:doughpie_dev@localhost:5432/doughpie";
// 以脚本位置锚定迁移目录，与调用方 cwd 解耦
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log(`数据库迁移完成：${migrationsFolder}`);
} finally {
  await client.end();
}
