import { X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Drawer, DrawerContent } from "../ui/drawer";
import { TaskDetail } from "./task-detail";

/**
 * 详情抽屉形态（ui.md §1）：看板/列表/搜索内点击 → 右侧 480px 滑出；
 * 背景页由路由层 backgroundLocation 保持挂载，关闭即返回背景页。
 */
export function TaskDrawer() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <DrawerContent aria-label="任务详情" className="flex flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-[13px] font-medium text-muted-foreground">任务详情</span>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="关闭详情"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {taskId ? <TaskDetail taskId={taskId} variant="drawer" /> : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
