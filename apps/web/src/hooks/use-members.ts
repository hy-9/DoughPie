import { useQuery } from "@tanstack/react-query";
import type { WorkspaceRole } from "@doughpie/shared";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth";

/** 成员列表（['members', wsId]；@选择器/负责人选择/权限降级共用） */
export function useMembers(wsId: string | undefined) {
  return useQuery({
    queryKey: ["members", wsId],
    queryFn: () => api.workspaces.listMembers(wsId as string),
    enabled: !!wsId,
  });
}

/**
 * 我在当前工作区的角色：viewer 只读（前端降级隐藏写入口；服务端仍兜底 403）。
 * 未取到（加载中/非成员）返回 null，调用方按只读处理。
 */
export function useMyRole(wsId: string | undefined): WorkspaceRole | null {
  const me = useAuthStore((s) => s.user);
  const { data: members } = useMembers(wsId);
  return members?.find((m) => m.user_id === me?.id)?.role ?? null;
}
