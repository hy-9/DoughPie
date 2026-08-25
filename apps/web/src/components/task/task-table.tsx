import type { List, Member } from "@doughpie/shared";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLists } from "../../hooks/use-lists";
import { useMembers } from "../../hooks/use-members";
import { useTasksQuery, type TaskFilters } from "../../hooks/use-tasks-query";
import { formatDue, isOverdue } from "../../lib/datetime";
import { PRIORITY_TEXT } from "../../lib/labels";
import { cn } from "../../lib/utils";
import { UserAvatar } from "../user-avatar";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { TaskStatusBadge } from "./task-status-badge";

/**
 * 列表渲染（P0-15 + P0-14 智能视图复用）：行高 40px，游标无限滚动（50/页，IntersectionObserver 触底加载）。
 * 行点击 → 详情抽屉（background 路由态）。
 */
export function TaskTable({ workspaceId, filters }: { workspaceId: string; filters: TaskFilters }) {
  const query = useTasksQuery(workspaceId, { limit: 50, ...filters });
  const { data: members } = useMembers(workspaceId);
  const { data: lists } = useLists(workspaceId);
  const navigate = useNavigate();
  const location = useLocation();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  // 触底自动加载下一页（游标分页，web.md §8）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const listNameById = new Map((lists ?? []).map((l: List) => [l.id, l.name]));

  const open = (taskId: string) => navigate(`/task/${taskId}`, { state: { background: location } });

  if (query.isLoading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-muted-foreground">任务加载失败</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-[13px] text-muted-foreground">没有符合条件的任务</p>
    );
  }

  return (
    <div className="min-w-[720px]">
      {/* 表头 */}
      <div className="grid h-8 grid-cols-[90px_minmax(0,1fr)_110px_64px_96px_110px] items-center gap-2 border-b border-border px-2 text-xs text-muted-foreground">
        <span>状态</span>
        <span>标题</span>
        <span>负责人</span>
        <span>优先级</span>
        <span>截止</span>
        <span>清单</span>
      </div>
      {items.map((t) => {
        const assignee = members?.find((m: Member) => m.user_id === t.assignee_id);
        const overdue = t.status !== "done" && isOverdue(t.due_at);
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => open(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") open(t.id);
            }}
            className="grid h-10 cursor-pointer grid-cols-[90px_minmax(0,1fr)_110px_64px_96px_110px] items-center gap-2 border-b border-border px-2 transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`任务：${t.title}`}
          >
            <span>
              <TaskStatusBadge status={t.status} />
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "truncate text-[13px]",
                  t.status === "done" && "text-muted-foreground line-through",
                )}
              >
                {t.title}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              {assignee ? (
                <>
                  <UserAvatar
                    username={assignee.username}
                    displayName={assignee.display_name}
                    size="sm"
                  />
                  <span className="truncate text-xs">{assignee.display_name}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">未分配</span>
              )}
            </span>
            <span
              className={cn(
                "text-xs",
                t.priority === "none" ? "text-muted-foreground" : undefined,
                t.priority === "high" && "text-priority-high",
                t.priority === "mid" && "text-priority-mid",
                t.priority === "low" && "text-priority-low",
              )}
            >
              {PRIORITY_TEXT[t.priority]}
            </span>
            <span
              className={cn(
                "tnum text-xs",
                overdue ? "text-priority-high" : "text-muted-foreground",
              )}
            >
              {t.due_at ? formatDue(t.due_at) : "—"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {listNameById.get(t.list_id) ?? "—"}
            </span>
          </div>
        );
      })}
      {/* 无限滚动哨兵 */}
      <div ref={sentinelRef} className="h-1" aria-hidden />
      {isFetchingNextPage ? (
        <p className="py-2 text-center text-xs text-muted-foreground">加载中…</p>
      ) : null}
      {!hasNextPage && items.length > 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">没有更多了</p>
      ) : null}
    </div>
  );
}
