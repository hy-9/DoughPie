import { TASK_STATUSES, type Task } from "@doughpie/shared";
import { Check } from "lucide-react";
import { useUpdateTask } from "../../hooks/use-update-task";
import { TASK_STATUS_TEXT } from "../../lib/labels";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { StatusDot } from "./task-status-badge";

/**
 * 状态流转菜单（四态自由流转不强制顺序，PLAN.md §6.2）。
 * 看板拖拽在 D 阶段接入，P0 流转入口统一在这里（详情抽屉/全页）。
 * 写操作带 If-Match: version；409 时 hook 内 toast + 强制 refetch。
 */
export function TaskStatusMenu({ task, disabled }: { task: Task; disabled?: boolean }) {
  const updateTask = useUpdateTask();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label="变更任务状态">
          <StatusDot status={task.status} />
          {TASK_STATUS_TEXT[task.status]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TASK_STATUSES.map((s) => (
          <DropdownMenuItem
            key={s}
            onSelect={() => {
              if (s !== task.status) {
                updateTask.mutate({ id: task.id, body: { status: s }, version: task.version });
              }
            }}
          >
            <StatusDot status={s} />
            {TASK_STATUS_TEXT[s]}
            {s === task.status ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
