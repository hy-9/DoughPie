import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@doughpie/api-client";
import { COPY } from "@doughpie/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../stores/auth";
import { LoginPage } from "./login-page";

// api 一律 mock（conventions.md §5.2：禁止真实网络）
const loginMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({
  api: { auth: { login: loginMock }, users: { me: vi.fn() } },
  UNAUTHORIZED_EVENT: "doughpie:unauthorized",
}));

describe("登录页（/login）", () => {
  beforeEach(() => {
    loginMock.mockReset();
    useAuthStore.setState({ user: null, status: "guest" });
  });

  it("空表单提交应显示 zod 中文校验提示（用户名/密码必填）", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入密码")).toBeInTheDocument();
    // 校验未过不打接口
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("服务端返回 INVALID_CREDENTIALS 应显示「用户名或密码不正确」", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(new ApiError(401, "INVALID_CREDENTIALS", "invalid"));
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("用户名"), "alice");
    await user.type(screen.getByLabelText("密码"), "pass1234");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({ username: "alice", password: "pass1234" }),
    );
    expect(await screen.findByText(COPY.auth.loginFailed)).toBeInTheDocument();
  });
});
