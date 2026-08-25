import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SUBTASKS_PER_TASK_MAX } from "@doughpie/shared";
import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/api-error";
import { cn } from "../../lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";

/**
 * 子任务 checklist（P0-9：仅标题+完成态；≤50 个/任务，超限服务端 409 SUBTASK_LIMIT）。
 */
export function SubtaskChecklist({ taskId, canWrite }: { taskId: string; canWrite: boolean }) {
  const [newTitle, setNewTitle] = useState("");
  const qc = useQueryClient();

  const subtasksQuery = useQuery({
    queryKey: ["subtasks", taskId],
    queryFn: () => api.subtasks.list(taskId),
  });
  const subtasks = subtasksQuery.data ?? [];
  const doneCount = subtasks.filter((s) => s.done).length;
  const atLimit = subtasks.length >= SUBTASKS_PER_TASK_MAX;

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["subtasks", taskId] });

  const create = useMutation({
    mutationFn: (title: string) => api.subtasks.create(taskId, { title }),
    onSuccess: () => {
      setNewTitle("");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.subtasks.update(id, { done }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.subtasks.remove(id),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (title && !atLimit) create.mutate(title);
  };

  return (
    <section aria-label="子任务" className="space-y-2">
      <h3 className="flex items-center gap-2 text-[13px] font-medium">
        子任务
        {subtasks.length > 0 ? (
          <span className="tnum text-xs text-muted-foreground">
            {doneCount}/{subtasks.length}
          </span>
        ) : null}
      </h3>

      {subtasksQuery.isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : (
        <ul className="space-y-1">
          {subtasks.map((s) => (
            <li
              key={s.id}
              className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted"
            >
              <Checkbox
                checked={s.done}
                disabled={!canWrite || toggle.isPending}
                onChange={(e) => toggle.mutate({ id: s.id, done: e.target.checked })}
                aria-label={`子任务「${s.title}」完成态`}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  s.done && "text-muted-foreground line-through",
                )}
              >
                {s.title}
              </span>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => remove.mutate(s.id)}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                  aria-label={`删除子任务「${s.title}」`}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={submit} className="flex items-center gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={atLimit ? "子任务数量已达上限" : "添加子任务，回车确认"}
            maxLength={200}
            disabled={atLimit || create.isPending}
            aria-label="新子任务标题"
            className="h-7 text-xs"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={atLimit || create.isPending || newTitle.trim().length === 0}
            aria-label="添加子任务"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </form>
      ) : null}
    </section>
  );
}
