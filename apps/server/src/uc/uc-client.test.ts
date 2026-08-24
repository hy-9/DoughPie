import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api-error.js";
import { createUcClient } from "./uc-client.js";

/**
 * UC HTTP 客户端（backend.md §2.9，契约以 UC 代码 C:\code\Rust\userSystem 为准）。
 * fetch 可注入，测试用 mock 严格校验请求形状；禁止访问真实 UC。
 */
const config = {
  enabled: true,
  baseUrl: "http://uc.test",
  clientId: "doughpie",
  clientSecret: "s3cret",
  redirectUri: "http://localhost:5173/auth/callback",
};

type MockCall = { url: string; init?: RequestInit };

function mockFetch(responder: (url: string, init?: RequestInit) => Response) {
  const calls: MockCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("ucClient（UC 契约形状，L2）", () => {
  it("exchangeCode：POST /oauth/token，请求体严格无 grant_type", async () => {
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify({ access_token: "uc-access", token_type: "Bearer" }), {
          status: 200,
        }),
    );
    const client = createUcClient(config, fetchImpl);
    const result = await client.exchangeCode({ code: "auth-code", codeVerifier: "verifier-1" });

    expect(result.accessToken).toBe("uc-access");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://uc.test/oauth/token");
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init?.body)) as Record<string, unknown>;
    // §2.9：请求体严格为这五个字段，无 grant_type
    // oxlint-disable-next-line no-array-sort -- tsconfig lib 为 ES2022，无 toSorted；此处排的是新数组无副作用
    expect(Object.keys(body).sort()).toEqual(
      // oxlint-disable-next-line no-array-sort -- 同上
      ["client_id", "client_secret", "code", "code_verifier", "redirect_uri"].sort(),
    );
    expect(body).not.toHaveProperty("grant_type");
    expect(body.code).toBe("auth-code");
    expect(body.client_id).toBe("doughpie");
    expect(body.client_secret).toBe("s3cret");
    expect(body.redirect_uri).toBe("http://localhost:5173/auth/callback");
    expect(body.code_verifier).toBe("verifier-1");
  });

  it("getUserinfo：GET /oauth/userinfo 带 Bearer，解析 {id, username, role, client_id}", async () => {
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ id: "uc-sub-1", username: "张三", role: "user", client_id: "doughpie" }),
          { status: 200 },
        ),
    );
    const client = createUcClient(config, fetchImpl);
    const info = await client.getUserinfo("uc-access");
    expect(info).toEqual({ id: "uc-sub-1", username: "张三", role: "user", client_id: "doughpie" });
    expect(calls[0]!.url).toBe("http://uc.test/oauth/userinfo");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer uc-access");
  });

  it("getForceLogoutBefore：Basic=client_id:client_secret，带 user_id query，解析 RFC3339", async () => {
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ user_id: "uc-sub-1", force_logout_before: "2026-08-24T10:00:00Z" }),
          { status: 200 },
        ),
    );
    const client = createUcClient(config, fetchImpl);
    const before = await client.getForceLogoutBefore("uc-sub-1");
    expect(before?.toISOString()).toBe("2026-08-24T10:00:00.000Z");
    expect(calls[0]!.url).toBe("http://uc.test/auth/force-logout-ts?user_id=uc-sub-1");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from("doughpie:s3cret").toString("base64")}`,
    );
  });

  it("getForceLogoutBefore：UC 返回 null 表示未强退", async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify({ user_id: "uc-sub-1", force_logout_before: null }), {
          status: 200,
        }),
    );
    const client = createUcClient(config, fetchImpl);
    expect(await client.getForceLogoutBefore("uc-sub-1")).toBeNull();
  });

  it("UC 返回扁平错误 {code,message} → 抛 ApiError 透传文案", async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify({ code: "AUTH", message: "授权码已过期" }), { status: 400 }),
    );
    const client = createUcClient(config, fetchImpl);
    const err = await client
      .exchangeCode({ code: "bad", codeVerifier: "v" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("授权码已过期");
  });

  it("网络异常 → ApiError（UC 不可用）", async () => {
    const failingFetch = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const client = createUcClient(config, failingFetch);
    const err = await client.getUserinfo("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});
