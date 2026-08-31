import { NoWorkspacePrompt } from "../components/layout/no-workspace-prompt";
import { KanbanBoard } from "../components/task/kanban-board";
import { Skeleton } from "../components/ui/skeleton";
import { useCurrentWorkspace } from "../hooks/use-current-workspace";

/**
 * 看板页（/，首屏主视图）：三列渲染 + 列头新建；无工作区时引导建区。
 */
export function BoardPage() {
  const { workspace, isLoading } = useCurrentWorkspace();

  if (isLoading) {
    return (
      <div className="flex items-start gap-3 p-4">
        <Skeleton className="h-64 w-72" />
        <Skeleton className="h-64 w-72" />
        <Skeleton className="h-64 w-72" />
      </div>
    );
  }

  if (!workspace) return <NoWorkspacePrompt />;

  return <KanbanBoard workspace={workspace} />;
}
