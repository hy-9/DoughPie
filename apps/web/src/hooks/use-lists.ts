import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/** 清单树（Query key 与实体对应：['lists', wsId]，web.md §3） */
export function useLists(wsId: string | undefined) {
  return useQuery({
    queryKey: ["lists", wsId],
    queryFn: () => api.lists.list(wsId as string),
    enabled: !!wsId,
  });
}
