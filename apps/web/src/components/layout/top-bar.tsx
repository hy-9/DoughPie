import { Bell, LogOut, Search, Settings, ShieldCheck, Users } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCurrentWorkspace } from "../../hooks/use-current-workspace";
import { useUnreadCount } from "../../hooks/use-unread-count";
import { useAuthStore } from "../../stores/auth";
import { UserAvatar } from "../user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * 顶栏（ui.md §5）：工作区切换 ▾ │ 搜索 Ctrl+K │ 🔔通知（未读数）│ 头像菜单。
 */
export function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { workspace } = useCurrentWorkspace();
  const unread = useUnreadCount(!!workspace);

  const unreadCount = unread.data?.count ?? 0;
  const unreadLabel = unread.data?.hasMore ? "50+" : String(unreadCount);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <WorkspaceSwitcher />
      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-2 flex h-8 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-muted-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="搜索任务（Ctrl+K）"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">搜索任务…</span>
        <kbd className="ml-auto rounded border border-border bg-muted px-1 text-[10px] leading-4">
          Ctrl K
        </kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate("/notifications")}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={unreadCount > 0 ? `通知中心（${unreadLabel} 条未读）` : "通知中心"}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="tnum absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-notify-high px-1 text-[10px] leading-none text-primary-foreground">
              {unreadLabel}
            </span>
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded-lg px-1.5 transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="用户菜单"
            >
              <UserAvatar
                username={user?.username ?? ""}
                displayName={user?.display_name}
                size="sm"
              />
              <span className="max-w-[120px] truncate text-[13px]">
                {user?.display_name ?? user?.username}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => navigate("/settings")}>
              <Settings className="h-3.5 w-3.5" /> 个人设置
            </DropdownMenuItem>
            {workspace ? (
              <DropdownMenuItem onSelect={() => navigate(`/ws/${workspace.id}/settings`)}>
                <Users className="h-3.5 w-3.5" /> 工作区设置
              </DropdownMenuItem>
            ) : null}
            {user?.role === "admin" ? (
              <DropdownMenuItem onSelect={() => navigate("/admin/users")}>
                <ShieldCheck className="h-3.5 w-3.5" /> 实例管理
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void logout().then(() =>
                  navigate("/login", { replace: true, state: { from: location.pathname } }),
                );
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> 退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
