import { z } from "zod";

/**
 * 环境变量解析（zod 单一入口，backend.md §2.6/§9）。
 * 启动即校验，缺关键配置直接失败，避免带病运行；密钥只经 process.env 注入，禁止打印。
 */
const processEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8699),
  DATABASE_URL: z.string().min(1, "缺少 DATABASE_URL"),
  // 自签 JWT HS256 密钥，生产必须强随机
  JWT_SECRET: z.string().min(1, "缺少 JWT_SECRET"),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(1800),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(10),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  // UC 集成默认关闭 = 独立运行；开启时四项必须齐全
  UC_ENABLED: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  UC_BASE_URL: z.string().url().default("http://localhost:8698"),
  UC_CLIENT_ID: z.string().default(""),
  UC_CLIENT_SECRET: z.string().default(""),
  UC_REDIRECT_URI: z.string().default(""),
});

export interface UcConfig {
  enabled: boolean;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  /** access token 寿命（秒） */
  accessTokenTtlSec: number;
  /** refresh token 滑动寿命（天） */
  refreshTokenTtlDays: number;
  loginMaxFailures: number;
  loginLockMinutes: number;
  uc: UcConfig;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const p = processEnvSchema.parse(source);
  if (p.UC_ENABLED && (!p.UC_CLIENT_ID || !p.UC_CLIENT_SECRET || !p.UC_REDIRECT_URI)) {
    throw new Error("UC_ENABLED=true 时 UC_CLIENT_ID/UC_CLIENT_SECRET/UC_REDIRECT_URI 必须配置");
  }
  return {
    nodeEnv: p.NODE_ENV,
    port: p.PORT,
    databaseUrl: p.DATABASE_URL,
    jwtSecret: p.JWT_SECRET,
    accessTokenTtlSec: p.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: p.REFRESH_TOKEN_TTL_DAYS,
    loginMaxFailures: p.LOGIN_MAX_FAILURES,
    loginLockMinutes: p.LOGIN_LOCK_MINUTES,
    uc: {
      enabled: p.UC_ENABLED,
      baseUrl: p.UC_BASE_URL.replace(/\/+$/, ""),
      clientId: p.UC_CLIENT_ID,
      clientSecret: p.UC_CLIENT_SECRET,
      redirectUri: p.UC_REDIRECT_URI,
    },
  };
}

/** 测试库默认地址（任务约定：代码内置默认值，仅测试基建使用） */
export const DEFAULT_TEST_DATABASE_URL =
  "postgres://doughpie:doughpie_dev@localhost:5432/doughpie_test";
