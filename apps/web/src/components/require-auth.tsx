import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import { Skeleton } from "./ui/skeleton";

/** 全屏骨架：会话自检（bootstrap）中的占位，避免保护页闪烁 */
function BootSkeleton() {
  return (
    <div className="flex h-screen flex-col gap-3 p-6" data-testid="boot-skeleton">
      <Skeleton className="h-10 w-full" />
      <div className="flex min-h-0 flex-1 gap-3">
        <Skeleton className="h-full w-60" />
        <Skeleton className="h-full flex-1" />
      </div>
    </div>
  );
}

/**
 * 路由守卫（web.md §2 保护页）：
 * unknown → 全屏骨架；guest → 跳 /login 并记住回跳目标；authed → 放行。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === "unknown") return <BootSkeleton />;
  if (status === "guest") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
