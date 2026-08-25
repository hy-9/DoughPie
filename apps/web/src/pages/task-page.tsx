import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { TaskDetail } from "../components/task/task-detail";
import { Button } from "../components/ui/button";
import { NotFoundPage } from "./not-found-page";

/**
 * 任务详情全页形态（ui.md §1：通知深链/直接访问 URL 全页渲染，与抽屉同一 TaskDetail 组件）。
 */
export function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();

  if (!taskId) return <NotFoundPage />;

  return (
    <div className="p-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-2">
        <ArrowLeft className="h-3.5 w-3.5" /> 返回
      </Button>
      <TaskDetail taskId={taskId} variant="page" />
    </div>
  );
}
