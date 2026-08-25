import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * 组件测试配置（conventions.md §5：vitest + jsdom + testing-library）。
 * 与 vite.config.ts 分离：测试不需要 dev 代理与构建插件外的配置。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
  },
});
