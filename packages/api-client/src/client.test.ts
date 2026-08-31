import type { TokenPair } from "@doughpie/shared";
import { describe, expect, it } from "vitest";
import { ApiError, DoughpieClient } from "./client.js";
import { MemoryTokenStore } from "./token-store.js";

const TOKENS: TokenPair = { access_token: "a1", expires_in: 1800, refresh_token: "r1" };
const NEW_TOKENS: TokenPair = { access_token: "a2", expires_in: 1800, refresh_token: "r2" };

type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(handler: FetchHandler, onUnauthorized?: () => void) {
  const calls: { url: string; init: RequestInit }[] = [];
  const store = new MemoryTokenStore();
  const client = new DoughpieClient({
    tokenStore: store,
    onUnauthorized,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init: init ?? {} });
      return handler(u, init ?? {});
    }) as typeof fetch,
  });
  return { client, store, calls };
}

describe("api-client 认证与单飞刷新（web.md §6）", () => {
  it("已登录请求自动带 Bearer 头", async () => {
    const { client, store, calls } = makeClient(async () => json({ ok: true }));
    store.setTokens(TOKENS);
    await client.users.me();
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer a1" });
  });

  it("401 触发静默刷新并重放原请求", async () => {
    const { client, store } = makeClient(async (url, init) => {
      if (url.endsWith("/auth/refresh")) return json(NEW_TOKENS);
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer a1"
        ? json({ code: "TOKEN_EXPIRED", message: "x" }, 401)
        : json({ id: "u1" });
    });
    store.setTokens(TOKENS);
    const user = await client.users.me();
    expect(user).toMatchObject({ id: "u1" });
    expect(store.getAccessToken()).toBe("a2");
  });

  it("并发 401 只刷新一次（单飞）", async () => {
    let refreshCount = 0;
    const { client, store } = makeClient(async (_url, init) => {
      if (_url.endsWith("/auth/refresh")) {
        refreshCount++;
        // 模拟网络延迟，放大并发窗口
        await new Promise((r) => setTimeout(r, 20));
        return json(NEW_TOKENS);
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer a1" ? json({ code: "TOKEN_EXPIRED", message: "x" }, 401) : json({});
    });
    store.setTokens(TOKENS);
    await Promise.all([client.users.me(), client.workspaces.list(), client.notifications.list()]);
    expect(refreshCount).toBe(1);
  });

  it("刷新失败 → 清 token + 触发 onUnauthorized", async () => {
    let unauthorizedCalled = false;
    const { client, store } = makeClient(
      async (url) =>
        url.endsWith("/auth/refresh")
          ? json({ code: "REFRESH_REUSED", message: "重用" }, 401)
          : json({ code: "TOKEN_EXPIRED", message: "x" }, 401),
      () => {
        unauthorizedCalled = true;
      },
    );
    store.setTokens(TOKENS);
    await expect(client.users.me()).rejects.toThrow(ApiError);
    expect(store.getAccessToken()).toBeNull();
    expect(unauthorizedCalled).toBe(true);
  });
});

describe("api-client 请求构造", () => {
  it("错误响应映射为 ApiError（code + status）", async () => {
    const { client } = makeClient(async () =>
      json({ code: "USERNAME_TAKEN", message: "占用" }, 409),
    );
    const err = await client.auth
      .register({ username: "doufu", password: "abc12345" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("USERNAME_TAKEN");
    expect((err as ApiError).status).toBe(409);
  });

  it("query 序列化：数组→重复 key，布尔→true/false，undefined 跳过", async () => {
    const { client, calls } = makeClient(async () => json({ items: [], next_cursor: null }));
    await client.tasks.list("ws1", {
      status: ["todo", "doing"],
      unread_marker: undefined,
      q: "设计",
    } as never);
    const url = new URL(calls[0]!.url, "http://localhost");
    expect(url.searchParams.getAll("status")).toEqual(["todo", "doing"]);
    expect(url.searchParams.get("q")).toBe("设计");
  });

  it("通知查询布尔参数序列化为 true 字符串", async () => {
    const { client, calls } = makeClient(async () => json({ items: [], next_cursor: null }));
    await client.notifications.list({ unread_only: true });
    expect(new URL(calls[0]!.url, "http://localhost").searchParams.get("unread_only")).toBe("true");
  });

  it("任务写操作携带 If-Match 版本头", async () => {
    const { client, calls } = makeClient(async () => json({ id: "t1" }));
    await client.tasks.update("t1", { title: "新标题" }, 3);
    expect((calls[0]!.init.headers as Record<string, string>)["If-Match"]).toBe("3");
  });

  it("function 风格 fetchImpl 被调用时 this 不是 client（避免浏览器 Illegal invocation）", async () => {
    const thisValues: unknown[] = [];
    const store = new MemoryTokenStore();
    const client = new DoughpieClient({
      tokenStore: store,
      fetchImpl: async function (this: unknown, _url: string | URL | Request) {
        thisValues.push(this);
        return json(TOKENS);
      } as typeof fetch,
    });
    await client.auth.register({ username: "doufu", password: "abc12345" });
    expect(thisValues).toHaveLength(1);
    expect(thisValues[0]).not.toBe(client);
  });
});
