import { describe, expect, it } from "vitest";
import { API_PREFIX, ROUTES } from "./routes.js";

describe("路由契约", () => {
  it("参数化路由生成正确路径", () => {
    expect(ROUTES.task("t1")).toBe("/tasks/t1");
    expect(ROUTES.workspaceMember("w1", "u1")).toBe("/workspaces/w1/members/u1");
    expect(ROUTES.mentionRemind("t1", "u1")).toBe("/tasks/t1/mentions/u1/remind");
  });

  it("所有路由不含 /api/v1 前缀（前缀由服务端统一挂载）", () => {
    const walk = (v: unknown): string[] => {
      if (typeof v === "string") return [v];
      if (typeof v === "function") return [];
      if (v && typeof v === "object") return Object.values(v).flatMap(walk);
      return [];
    };
    for (const p of walk(ROUTES)) {
      expect(p.startsWith(API_PREFIX)).toBe(false);
      expect(p.startsWith("/")).toBe(true);
    }
  });
});
