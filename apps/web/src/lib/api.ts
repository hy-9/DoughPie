import { DoughpieClient, type TokenStore } from "@doughpie/api-client";

/**
 * 全局 API client 单例（web.md §6）：
 * - token 存 localStorage（20 人内部工具接受 XSS 面，见 web.md §6 决策）
 * - 401 单飞静默刷新由 client 内建；刷新彻底失败 → 广播事件由 auth store 收尾（跳登录）
 */
const ACCESS_KEY = "doughpie.access_token";
const REFRESH_KEY = "doughpie.refresh_token";

const localStorageTokenStore: TokenStore = {
  getAccessToken: () => localStorage.getItem(ACCESS_KEY),
  getRefreshToken: () => localStorage.getItem(REFRESH_KEY),
  setTokens: (tokens) => {
    localStorage.setItem(ACCESS_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** 会话失效事件：auth store 监听并清理状态跳登录（避免 api → store 的循环依赖） */
export const UNAUTHORIZED_EVENT = "doughpie:unauthorized";

export const api = new DoughpieClient({
  tokenStore: localStorageTokenStore,
  onUnauthorized: () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)),
});
