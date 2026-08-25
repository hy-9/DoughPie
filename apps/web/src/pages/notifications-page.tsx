import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { COPY, type Notification, type NotificationType } from "@doughpie/shared";
import {
  Activity,
  AlarmClock,
  AtSign,
  Check,
  Clock,
  Info,
  ListChecks,
  UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";
import { formatRelative } from "../lib/datetime";
import {
  groupNotifications,
  NOTIFICATION_TYPE_TEXT,
  notificationCommentId,
  notificationExcerpt,
  notificationTaskId,
} from "../lib/notifications";
import { cn } from "../lib/utils";

const TYPE_ICON: Record<NotificationType, typeof AtSign> = {
  mention: AtSign,
  assigned: UserPlus,
  overdue: AlarmClock,
  progress: Activity,
  due: Clock,
  incomplete: ListChecks,
  system: Info,
};

/**
 * 通知中心（/notifications，简版，PLAN.md §5.4）：
 * 按任务分组聚合（同任务折叠，组显未读数徽标+组内最高等级色点）；三级色点 🔴🟠⚪；
 * mention 条「收到」确认（永不自动已读）；条目点击深链任务详情（评论通知锚定楼层）。
 * 等级/类型筛选、组级已读是 P1 范围。
 */
export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ["notifications", "center", { unread: unreadOnly }],
    queryFn: ({ pageParam }) =>
      api.notifications.list({
        cursor: pageParam || undefined,
        limit: 50,
        ...(unreadOnly ? { unread_only: true } : {}),
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const groups = useMemo(() => groupNotifications(items), [items]);
  const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["notifications"] });

  const ack = useMutation({
    mutationFn: (id: string) => api.notifications.ack(id),
    onSuccess: () => {
      toast.success(COPY.mention.ackDone);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const markAllRead = useMutation({
    mutationFn: (ids: string[]) => api.notifications.markRead({ ids }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });

  /** 深链（ui.md §1：通知深链 → 全页渲染；评论通知锚定楼层） */
  const goDetail = (n: Notification) => {
    const taskId = notificationTaskId(n);
    if (!taskId) return;
    const commentId = notificationCommentId(n);
    navigate(`/task/${taskId}${commentId ? `#comment-${commentId}` : ""}`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">通知中心</h1>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            只看未读
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={unreadIds.length === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate(unreadIds)}
          >
            全部已读
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : query.isError ? (
        <div className="py-12 text-center">
          <p className="text-[13px] text-muted-foreground">通知加载失败</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-muted-foreground">
          {unreadOnly ? "没有未读通知" : "暂无通知"}
        </p>
      ) : (
        groups.map((g) => (
          <section
            key={g.task_id ?? g.items[0]?.id ?? "empty"}
            className="rounded-lg border border-border bg-card"
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              {/* 组内最高等级色点（🔴🟠⚪，notify-* token） */}
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  g.top_level === "high" && "bg-notify-high",
                  g.top_level === "mid" && "bg-notify-mid",
                  g.top_level === "low" && "bg-notify-low",
                )}
                aria-label={`组内最高等级：${g.top_level}`}
              />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:text-foreground"
                onClick={() => {
                  const first = g.items[0];
                  if (first) goDetail(first);
                }}
                disabled={!g.task_id}
              >
                {g.task_title ?? (g.task_id ? "任务" : "其他通知")}
              </button>
              {g.unread_count > 0 ? (
                <Badge variant="notify-high" className="tnum">
                  {g.unread_count} 未读
                </Badge>
              ) : null}
            </header>
            <ul>
              {g.items.map((n) => {
                const Icon = TYPE_ICON[n.type];
                const excerpt = notificationExcerpt(n);
                const deeplink = notificationTaskId(n) !== null;
                return (
                  <li
                    key={n.id}
                    className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        n.level === "high" && "text-notify-high",
                        n.level === "mid" && "text-notify-mid",
                        n.level === "low" && "text-notify-low",
                      )}
                      aria-hidden
                    />
                    <button
                      type="button"
                      disabled={!deeplink}
                      onClick={() => goDetail(n)}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={cn(
                          "text-[13px] leading-5",
                          n.read_at ? "text-muted-foreground" : "font-medium",
                        )}
                      >
                        {NOTIFICATION_TYPE_TEXT[n.type]}
                        {excerpt ? `：${excerpt}` : ""}
                      </span>
                      <span className="tnum block text-xs text-muted-foreground">
                        {formatRelative(n.created_at)}
                      </span>
                    </button>
                    {/* 提及确认闭环：mention 永不自动已读，须点「收到」（§5.5） */}
                    {n.type === "mention" ? (
                      n.ack_at ? (
                        <Badge variant="mention-acked" className="shrink-0">
                          <Check className="h-3 w-3" /> 已确认
                        </Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={ack.isPending}
                          onClick={() => ack.mutate(n.id)}
                        >
                          收到
                        </Button>
                      )
                    ) : !n.read_at ? (
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-notify-high"
                        aria-label="未读"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {query.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "加载中…" : "加载更多"}
        </Button>
      ) : null}
    </div>
  );
}
