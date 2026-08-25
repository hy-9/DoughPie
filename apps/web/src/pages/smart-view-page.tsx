import { useState } from "react";
import {
  DEFAULT_FILTER,
  TaskFilterBar,
  toTaskFilters,
  type FilterValue,
} from "../components/task/task-filter-bar";
import { TaskTable } from "../components/task/task-table";
import { Skeleton } from "../components/ui/skeleton";
import { useCurrentWorkspace } from "../hooks/use-current-workspace";

const VIEW_TITLE = {
  today: "今天",
  mine: "我负责的",
  overdue: "已逾期",
} as const;

/**
 * 智能视图（P0-14，侧栏常驻）：固定条件查询，复用列表渲染。
 * view=today 的 tz_offset 由 useTasksQuery 统一注入（设备本地时区，PLAN.md §8）。
 */
export function SmartViewPage({ view }: { view: "today" | "mine" | "overdue" }) {
  const { workspace } = useCurrentWorkspace();
  const [filter, setFilter] = useState<FilterValue>(DEFAULT_FILTER);

  if (!workspace) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <h1 className="text-lg font-semibold">{VIEW_TITLE[view]}</h1>
      <TaskFilterBar workspaceId={workspace.id} value={filter} onChange={setFilter} />
      <TaskTable workspaceId={workspace.id} filters={{ view, ...toTaskFilters(filter) }} />
    </div>
  );
}
