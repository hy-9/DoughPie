import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@doughpie/api-client";
import { COPY } from "@doughpie/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "../../../tests/factories";
import { TaskStatusMenu } from "./task-status-menu";

// api 与 toast 一律 mock（禁真实网络；断言冲突提示文案）
const updateMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({
  api: { tasks: { update: updateMock } },
  UNAUTHORIZED_EVENT: "doughpie:unauthorized",
}));
const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

/**
 * 任务状态流转菜单（web.md §3 乐观更新约定）：
 * 流转 → PATCH + If-Match: version；409 VERSION_CONFLICT → toast 提示 + 强制 refetch（invalidate）。
 */
describe("任务状态菜单流转", () => {
  let qc: QueryClient;

  beforeEach(() => {
    updateMock.mockReset();
    toastErrorMock.mockReset();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  const renderMenu = (task = makeTask({ status: "todo", version: 3 })) => {
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <TaskStatusMenu task={task} />
      </QueryClientProvider>,
    );
    return { task, invalidateSpy };
  };

  it("选择新状态应以当前 version 触发乐观锁更新", async () => {
    const user = userEvent.setup();
    const { task } = renderMenu();
    updateMock.mockResolvedValue({ ...task, status: "doing" });

    await user.click(screen.getByRole("button", { name: "变更任务状态" }));
    await user.click(await screen.findByText("进行中"));

    expect(updateMock).toHaveBeenCalledWith(task.id, { status: "doing" }, 3);
  });

  it("409 冲突应提示「已被他人修改」并强制 refetch", async () => {
    const user = userEvent.setup();
    const { task, invalidateSpy } = renderMenu();
    updateMock.mockRejectedValue(new ApiError(409, "VERSION_CONFLICT", "conflict"));

    await user.click(screen.getByRole("button", { name: "变更任务状态" }));
    await user.click(await screen.findByText("进行中"));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(COPY.common.versionConflict));
    // 强制 refetch：失效详情与列表缓存（['task',id] / ['tasks']）
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["task", task.id] }),
      ),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["tasks"] }));
  });
});
