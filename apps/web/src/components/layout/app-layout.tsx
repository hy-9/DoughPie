import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { SearchCommand } from "./search-command";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * 主布局（ui.md §5 蓝图）：顶栏 + 左侧栏 240px + 主区；详情抽屉由路由层叠加。
 * Ctrl+K / ⌘K 全局唤起搜索命令面板（web.md §7）。
 */
export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar onOpenSearch={() => setSearchOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
