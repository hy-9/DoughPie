import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation, type Location } from "react-router-dom";
import { AppLayout } from "./components/layout/app-layout";
import { RequireAuth } from "./components/require-auth";
import { TaskDrawer } from "./components/task/task-drawer";
import { Toaster } from "./components/ui/sonner";
import { AdminUsersPage } from "./pages/admin-users-page";
import { AuthCallbackPage } from "./pages/auth-callback-page";
import { AuthLinkPage } from "./pages/auth-link-page";
import { BoardPage } from "./pages/board-page";
import { InvitePage } from "./pages/invite-page";
import { ListPage } from "./pages/list-page";
import { LoginPage } from "./pages/login-page";
import { NotFoundPage } from "./pages/not-found-page";
import { NotificationsPage } from "./pages/notifications-page";
import { RegisterPage } from "./pages/register-page";
import { SettingsPage } from "./pages/settings-page";
import { SmartViewPage } from "./pages/smart-view-page";
import { TaskPage } from "./pages/task-page";
import { WorkspaceSettingsPage } from "./pages/workspace-settings-page";
import { useAuthStore } from "./stores/auth";

/**
 * 路由表（web.md §2）。P1 路由（/activity /dashboard /wiki /calendar /gantt）本包不做。
 * 详情抽屉双形态（ui.md §1）：看板/列表内点击卡片带 background 跳 /task/:id → 抽屉；
 * 直接访问 URL（无 background state）→ 全页渲染同一 TaskDetail 组件。
 */
function AppRoutes() {
  const location = useLocation();
  const background = (location.state as { background?: Location } | null)?.background;
  return (
    <>
      <Routes location={background ?? location}>
        {/* 公开页 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/link" element={<AuthLinkPage />} />
        {/* 邀请预览需登录（邀请信息接口鉴权），但独立于主布局 */}
        <Route
          path="/invite/:code"
          element={
            <RequireAuth>
              <InvitePage />
            </RequireAuth>
          }
        />
        {/* 主布局保护页 */}
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<BoardPage />} />
          <Route path="/list/:listId" element={<ListPage />} />
          <Route path="/today" element={<SmartViewPage view="today" />} />
          <Route path="/mine" element={<SmartViewPage view="mine" />} />
          <Route path="/overdue" element={<SmartViewPage view="overdue" />} />
          <Route path="/task/:taskId" element={<TaskPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/ws/:id/settings" element={<WorkspaceSettingsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      {/* 背景页保持挂载，抽屉叠层滑出（ui.md §5 布局蓝图） */}
      {background ? (
        <Routes>
          <Route path="/task/:taskId" element={<TaskDrawer />} />
        </Routes>
      ) : null}
    </>
  );
}

export function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  return (
    <BrowserRouter>
      <AppRoutes />
      <Toaster />
    </BrowserRouter>
  );
}
