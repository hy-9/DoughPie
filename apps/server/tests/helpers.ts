import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createDb, type Db } from "../src/db.js";
import { DEFAULT_TEST_DATABASE_URL, type AppEnv } from "../src/env.js";
import type { UcClient } from "../src/uc/uc-client.js";

/** 测试基建：连接测试库、构造测试 env、清库。仅允许打真实测试 PG，禁真实网络/UC。 */

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export function createTestDb(): { db: Db; close: () => Promise<void> } {
  const { db, client } = createDb(testDatabaseUrl());
  return { db, close: () => client.end() };
}

/** 每用例清库（CASCADE 处理外键依赖），保证用例间无共享状态 */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE refresh_tokens, user_identities, users CASCADE`);
}

/** 测试用 AppEnv：固定密钥与阈值，可用 overrides 覆盖（如开启 UC） */
export function testEnv(overrides?: Partial<AppEnv>): AppEnv {
  return {
    nodeEnv: "test",
    port: 8699,
    databaseUrl: testDatabaseUrl(),
    jwtSecret: "test-jwt-secret",
    accessTokenTtlSec: 1800,
    refreshTokenTtlDays: 30,
    loginMaxFailures: 10,
    loginLockMinutes: 15,
    uc: {
      enabled: false,
      baseUrl: "http://uc.test",
      clientId: "doughpie",
      clientSecret: "test-uc-secret",
      redirectUri: "http://localhost:5173/auth/callback",
    },
    ...overrides,
  };
}

/** 集成测试装配：真实测试 PG + 关日志 + 可注入 mock UcClient；UC 强退轮询默认关闭 */
export async function buildTestApp(options?: {
  env?: Partial<AppEnv>;
  ucClient?: UcClient;
}): Promise<FastifyInstance> {
  return buildApp({
    env: testEnv(options?.env),
    ucClient: options?.ucClient,
    startUcPoller: false,
    logger: false,
  });
}
