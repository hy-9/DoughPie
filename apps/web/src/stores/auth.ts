import type { LoginBody, RegisterBody, User } from "@doughpie/shared";
import { create } from "zustand";
import { api, UNAUTHORIZED_EVENT } from "../lib/api";

/**
 * 会话状态（Zustand 只放 UI 态；服务器数据一律走 TanStack Query，web.md §3）。
 * bootstrap：启动时有 refresh_token 则拉 me（client 内建 401 单飞刷新兜底）。
 */
interface AuthState {
  user: User | null;
  /** unknown=启动自检中；authed=已登录；guest=未登录 */
  status: "unknown" | "authed" | "guest";
  bootstrap: () => Promise<void>;
  login: (body: LoginBody) => Promise<void>;
  register: (body: RegisterBody) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "unknown",

  bootstrap: async () => {
    if (!localStorage.getItem("doughpie.refresh_token")) {
      set({ user: null, status: "guest" });
      return;
    }
    try {
      const user = await api.users.me();
      set({ user, status: "authed" });
    } catch {
      // 刷新链已失败（onUnauthorized 会再广播一次，幂等清理）
      set({ user: null, status: "guest" });
    }
  },

  login: async (body) => {
    const tokens = await api.auth.login(body);
    localStorage.setItem("doughpie.access_token", tokens.access_token);
    localStorage.setItem("doughpie.refresh_token", tokens.refresh_token);
    const user = await api.users.me();
    set({ user, status: "authed" });
  },

  register: async (body) => {
    const tokens = await api.auth.register(body);
    localStorage.setItem("doughpie.access_token", tokens.access_token);
    localStorage.setItem("doughpie.refresh_token", tokens.refresh_token);
    const user = await api.users.me();
    set({ user, status: "authed" });
  },

  logout: async () => {
    try {
      await api.auth.logout();
    } finally {
      // 即使服务端调用失败也要本地登出
      set({ user: null, status: "guest" });
      localStorage.removeItem("doughpie.access_token");
      localStorage.removeItem("doughpie.refresh_token");
    }
  },

  setUser: (user) => set({ user }),
  clear: () => set({ user: null, status: "guest" }),
}));

// 会话彻底失效（刷新失败）→ 清理状态；路由守卫据 status 自然跳登录
if (typeof window !== "undefined") {
  window.addEventListener(UNAUTHORIZED_EVENT, () => {
    useAuthStore.getState().clear();
  });
}
