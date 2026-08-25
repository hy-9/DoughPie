import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api";
import { useUiStore } from "../stores/ui";

/**
 * 当前工作区解析：顶栏切换器「记住上次使用」（PLAN.md §8）——
 * ui store 持久化的 currentWorkspaceId 失效（退出/被移出）时兜底取第一个并回写。
 */
export function useCurrentWorkspace() {
  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.workspaces.list(),
  });
  const currentId = useUiStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspace = useUiStore((s) => s.setCurrentWorkspace);

  const workspaces = workspacesQuery.data ?? [];
  const workspace = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  useEffect(() => {
    if (workspace && workspace.id !== currentId) setCurrentWorkspace(workspace.id);
  }, [workspace, currentId, setCurrentWorkspace]);

  return {
    workspaces,
    workspace,
    isLoading: workspacesQuery.isLoading,
    isError: workspacesQuery.isError,
    refetch: workspacesQuery.refetch,
  };
}
