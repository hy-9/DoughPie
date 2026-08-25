import type { Member, Task } from "@doughpie/shared";
import { formatDue, isOverdue } from "../../lib/datetime";
import { cn } from "../../lib/utils";
import { UserAvatar } from "../user-avatar";
import { Badge } from "../ui/badge";

/**
 * 看板卡片（web.md §4）：优先级左色条 3px + 标题 + 负责人头像 + 截止（过期红）
 * + 子任务进度 n/m（DTO 携带 subtask_done/subtask_total）+ review「待验收」徽章。
 */
export function TaskCard({
  task,
  members,
  onOpen,
}: {
  task: Task;
  members: Member[] | undefined;
  onOpen: (taskId: string) => void;
}) {
  const assignee = members?.find((m) => m.user_id === task.assignee_id);
  const overdue = task.status !== "done" && isOverdue(task.due_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(task.id);
      }}
      className={cn(
        "relative cursor-pointer rounded-lg border border-border bg-card p-2.5 pl-3",
        "transition-colors duration-150 hover:border-ring",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label={`任务：${task.title}`}
    >
      {/* 优先级 3px 左色条（ui.md §8；none 无条） */}
      {task.priority !== "none" ? (
        <span
          className={cn(
            "absolute bottom-2 left-0 top-2 w-[3px] rounded-full",
            task.priority === "high" && "bg-priority-high",
            task.priority === "mid" && "bg-priority-mid",
            task.priority === "low" && "bg-priority-low",
          )}
          aria-hidden
        />
      ) : null}
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 break-words text-[13px] leading-5",
            task.status === "done" && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </p>
        {task.status === "review" ? (
          <Badge variant="state-review" className="shrink-0">
            待验收
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {assignee ? (
          <UserAvatar username={assignee.username} displayName={assignee.display_name} size="sm" />
        ) : (
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground"
            title="未分配"
            aria-label="未分配"
          >
            ?
          </span>
        )}
        {task.subtask_total > 0 ? (
          <span className="tnum text-xs text-muted-foreground" aria-label="子任务进度">
            {task.subtask_done}/{task.subtask_total}
          </span>
        ) : null}
        {task.due_at ? (
          <span
            className={cn(
              "tnum ml-auto text-xs",
              overdue ? "text-priority-high" : "text-muted-foreground",
            )}
          >
            {formatDue(task.due_at)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
