import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./models/schema.js";

/**
 * Drizzle 客户端装配（postgres.js 驱动）。
 * createDb 返回 { db, client }，client 用于 onClose 时断开连接池。
 */
export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];
export type DbClient = ReturnType<typeof createDb>["client"];
