import { useState } from "react";
import { CreateWorkspaceDialog } from "../components/layout/create-workspace-dialog";
import { KanbanBoard } from "../components/task/kanban-board";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useCurrentWorkspace } from "../hooks/use-current-workspace";

/**
 * 看板页（/，首屏主视图）：三列渲染 + 列头新建；无工作区时引导建区。
 */
export function BoardPage() {
  const { workspace, isLoading } = useCurrentWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-start gap-3 p-4">
        <Skeleton className="h-64 w-72" />
        <Skeleton className="h-64 w-72" />
        <Skeleton className="h-64 w-72" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-lg font-semibold">欢迎使用豆排排</p>
        <p className="text-[13px] text-muted-foreground">创建第一个工作区，或等待同事邀请你加入</p>
        <Button onClick={() => setCreateOpen(true)}>新建工作区</Button>
        <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    );
  }

  return <KanbanBoard workspace={workspace} />;
}
