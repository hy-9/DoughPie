import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  DEFAULT_FILTER,
  TaskFilterBar,
  toTaskFilters,
  type FilterValue,
} from "../components/task/task-filter-bar";
import { TaskTable } from "../components/task/task-table";
import { Skeleton } from "../components/ui/skeleton";
import { useCurrentWorkspace } from "../hooks/use-current-workspace";
import { useLists } from "../hooks/use-lists";

/**
 * 列表视图（/list/:listId，P0-15）：四筛 + 排序切换 + 50 条无限滚动（TaskTable 内触底加载）。
 */
export function ListPage() {
  const { listId } = useParams<{ listId: string }>();
  const { workspace } = useCurrentWorkspace();
  const { data: lists, isLoading } = useLists(workspace?.id);
  const [filter, setFilter] = useState<FilterValue>(DEFAULT_FILTER);

  const list = lists?.find((l) => l.id === listId);

  if (!workspace || isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        {/* 清单颜色为契约数据（自由 hex），圆点同侧栏 */}
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: list?.color ?? "var(--priority-none)" }}
          aria-hidden
        />
        <h1 className="text-lg font-semibold">{list?.name ?? "清单"}</h1>
      </div>
      <TaskFilterBar workspaceId={workspace.id} value={filter} onChange={setFilter} />
      {listId ? (
        <TaskTable
          workspaceId={workspace.id}
          filters={{ list_id: listId, ...toTaskFilters(filter) }}
        />
      ) : null}
    </div>
  );
}
