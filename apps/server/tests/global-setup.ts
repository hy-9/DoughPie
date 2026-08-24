import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { DEFAULT_TEST_DATABASE_URL } from "../src/env.js";

/**
 * vitest globalSetup：对测试库跑一遍迁移（幂等），保证 schema 与 drizzle/ 目录一致。
 * 注意 globalSetup 与测试 worker 不共享 process.env，worker 侧连接串由 vitest.config env 注入。
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
