import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../stores/auth";
import { RequireAuth } from "./require-auth";

/** /login 探针：回显守卫跳转携带的回跳目标（location.state.from） */
function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "";
  return <div>登录页{from ? `|from=${from}` : ""}</div>;
}

function renderGuarded(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <div>受保护内容</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** 路由守卫（web.md §2）：unknown → 全屏骨架；guest → /login（带 from）；authed → 放行 */
describe("路由守卫（RequireAuth）", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, status: "guest" });
  });

  it("会话自检中（unknown）应显示全屏骨架，不渲染保护内容", () => {
    useAuthStore.setState({ user: null, status: "unknown" });
    renderGuarded("/today");
    expect(screen.getByTestId("boot-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("受保护内容")).not.toBeInTheDocument();
  });

  it("guest 访问保护页应跳 /login 并记住回跳目标", () => {
    useAuthStore.setState({ user: null, status: "guest" });
    renderGuarded("/today");
    expect(screen.getByText("登录页|from=/today")).toBeInTheDocument();
    expect(screen.queryByText("受保护内容")).not.toBeInTheDocument();
  });

  it("authed 应直接放行保护内容", () => {
    useAuthStore.setState({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "alice",
        display_name: "爱丽丝",
        status: "active",
        role: "user",
        has_uc_identity: false,
        has_password: true,
        created_at: "2026-08-24T10:00:00.000Z",
        updated_at: "2026-08-24T10:00:00.000Z",
      },
      status: "authed",
    });
    renderGuarded("/today");
    expect(screen.getByText("受保护内容")).toBeInTheDocument();
  });
});
