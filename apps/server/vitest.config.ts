import { defineConfig } from "vitest/config";
import { DEFAULT_TEST_DATABASE_URL } from "./src/env.js";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // 集成测试共享同一测试库 + 每用例 truncate，必须串行防互相踩踏
    fileParallelism: false,
    env: {
      // worker 进程注入测试库连接串（globalSetup 的 process.env 不跨进程传递）
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
    },
  },
});
