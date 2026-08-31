import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SmartViewPage } from "./smart-view-page";

vi.mock("../lib/api", () => ({
  api: { workspaces: { create: vi.fn() } },
  UNAUTHORIZED_EVENT: "doughpie:unauthorized",
}));

const current = vi.hoisted(() => ({
  workspace: undefined as { id: string; name: string } | undefined,
  isLoading: false,
}));

vi.mock("../hooks/use-current-workspace", () => ({
  useCurrentWorkspace: () => ({
    workspace: current.workspace,
    workspaces: [],
    isLoading: current.isLoading,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
}));

function renderToday() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SmartViewPage view="today" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("智能视图空工作区", () => {
  beforeEach(() => {
    current.workspace = undefined;
    current.isLoading = false;
  });

  it("加载完成后无工作区应引导新建，而不是骨架屏", () => {
    renderToday();
    expect(screen.getByText("欢迎使用豆排排")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建工作区" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "今天" })).not.toBeInTheDocument();
  });
});
