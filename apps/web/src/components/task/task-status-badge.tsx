import type { TaskStatus } from "@doughpie/shared";
import { TASK_STATUS_TEXT } from "../../lib/labels";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

/** 状态圆点（ui.md §8：todo 灰 / doing 蓝 / review 琥珀 / done 绿） */
export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "todo" && "bg-state-todo",
        status === "doing" && "bg-state-doing",
        status === "review" && "bg-state-review",
        status === "done" && "bg-state-done",
        className,
      )}
      aria-hidden
    />
  );
}

/**
 * 任务状态徽章：review 态即「待验收」徽章（PLAN.md §6.2 四态预埋：P0 渲三列，review 带徽章）。
 */
export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge variant={`state-${status}`} className={className}>
      <StatusDot status={status} />
      {TASK_STATUS_TEXT[status]}
    </Badge>
  );
}
