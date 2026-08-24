import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { testEnv } from "../tests/helpers.js";

describe("健康检查", () => {
  it("GET /api/v1/health 返回 ok", async () => {
    const app = await buildApp({ env: testEnv(), logger: false });
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
