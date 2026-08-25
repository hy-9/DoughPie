import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * 顶栏铃铛未读数：取首页未读（≤50 条），有下一页游标则显示「50+」。
 * 服务端游标分页无 total，B3 简版按首页计数（P1 通知增强包再细化）。
 */
export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const page = await api.notifications.list({ unread_only: true, limit: 50 });
      return { count: page.items.length, hasMore: page.next_cursor !== null };
    },
    enabled,
    // 未读数需要一定的实时感（D 阶段 socket 失效前，轮询兜底）
    refetchInterval: 60_000,
  });
}
