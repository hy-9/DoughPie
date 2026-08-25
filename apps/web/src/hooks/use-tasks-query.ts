import { useInfiniteQuery } from "@tanstack/react-query";
import type { TaskQuery } from "@doughpie/shared";
import { api } from "../lib/api";

/**
 * 任务游标查询（看板三列 / 列表四筛 / 智能视图 / Ctrl+K 搜索共用通道）。
 * query 对象整体进 Query key（TanStack 结构化哈希，对象身份无碍）。
 */
export type TaskFilters = Partial<
  Pick<
    TaskQuery,
    | "view"
    | "list_id"
    | "assignee_id"
    | "due_from"
    | "due_to"
    | "q"
    | "sort"
    | "order"
    | "limit"
    | "status"
    | "priority"
  >
>;

export function useTasksQuery(wsId: string | undefined, filters: TaskFilters) {
  const query: Partial<TaskQuery> = { ...filters };
  // 智能视图「今天」按设备本地时区换算 UTC 区间（PLAN.md §8：UTC 存储 + 本地显示）
  if (query.view === "today" && query.tz_offset === undefined) {
    query.tz_offset = new Date().getTimezoneOffset();
  }
  return useInfiniteQuery({
    queryKey: ["tasks", wsId, query],
    queryFn: ({ pageParam }) =>
      api.tasks.list(wsId as string, { ...query, cursor: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!wsId,
  });
}
