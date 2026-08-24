import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * 开发期代理（web.md §2.6 端口约定）：
 * /api → server:8699；/socket.io → server:8699（ws）；/uc → 统一用户中心:8698（可选）。
 * 生产构建后经 Caddy 同源反代，无需变量。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8699",
      "/socket.io": {
        target: "http://localhost:8699",
        ws: true,
      },
      "/uc": "http://localhost:8698",
    },
  },
});
