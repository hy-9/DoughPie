import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PRIORITIES,
  RECURRENCE_FREQS,
  type Priority,
  type RecurrenceFreq,
  type Task,
  type UpdateTaskBody,
} from "@doughpie/shared";
import { Repeat, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useLists } from "../../hooks/use-lists";
import { useMembers, useMyRole } from "../../hooks/use-members";
import { useUpdateTask } from "../../hooks/use-update-task";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/api-error";
import { fromLocalInputValue, toLocalInputValue } from "../../lib/datetime";
import { PRIORITY_TEXT } from "../../lib/labels";
import { AssigneePicker } from "./assignee-picker";
import { CommentSection } from "./comment-section";
import { SubtaskChecklist } from "./subtask-checklist";
import { TaskStatusMenu } from "./task-status-menu";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input, Textarea } from "../ui/input";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";

const RECURRENCE_TEXT: Record<RecurrenceFreq, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
};

/**
 * 任务详情（ui.md §1 抽屉+路由双形态的共用组件）：
 * 字段区（标题/描述/负责人/优先级/截止/提醒/重复规则简版）+ 子任务 + 讨论区。
 * 所有字段写走 If-Match 乐观锁（useUpdateTask：乐观更新 + 409 强制 refetch + 提示）。
 */
export function TaskDetail({ taskId, variant }: { taskId: string; variant: "drawer" | "page" }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateTask = useUpdateTask();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.tasks.get(taskId),
  });
  const task = taskQuery.data;
  const wsId = task?.workspace_id;
  const { data: members } = useMembers(wsId);
  const { data: lists } = useLists(wsId);
  const myRole = useMyRole(wsId);
  const canWrite = myRole === "owner" || myRole === "member";

  // 打开详情 → 该任务 progress 类通知自动已读（PLAN.md §5.4）；mention 永不自动已读（须点「收到」）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await api.notifications.list({ unread_only: true, limit: 100 });
        const ids = page.items
          .filter((n) => n.type === "progress" && n.payload["task_id"] === taskId)
          .map((n) => n.id);
        if (!cancelled && ids.length > 0) {
          await api.notifications.markRead({ ids });
          void qc.invalidateQueries({ queryKey: ["notifications"] });
        }
      } catch {
        // 自动已读失败不打断详情浏览（下次打开重试）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, qc]);

  const deleteTask = useMutation({
    mutationFn: (t: Task) => api.tasks.remove(t.id, t.version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("任务已删除");
      navigate(-1);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (taskQuery.isLoading) {
    return (
      <div className="space-y-3 p-1" data-testid="task-detail-loading">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (taskQuery.isError || !task) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-muted-foreground">{errorMessage(taskQuery.error)}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void taskQuery.refetch()}
        >
          重试
        </Button>
      </div>
    );
  }

  /** 统一字段保存入口：version 取当前详情快照（乐观锁） */
  const save = (body: UpdateTaskBody) =>
    updateTask.mutate({ id: task.id, body, version: task.version });

  const recurrence = task.recurrence;

  return (
    <div className={variant === "page" ? "mx-auto max-w-3xl space-y-6 p-6" : "space-y-6"}>
      {/* 标题区：状态流转菜单 + 行内标题编辑 + 删除 */}
      <div className="flex items-start gap-2">
        <TaskStatusMenu task={task} disabled={!canWrite} />
        {canWrite ? (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto text-muted-foreground hover:text-destructive"
            aria-label="删除任务"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {canWrite ? (
        <Input
          key={`${task.id}:${task.updated_at}`}
          defaultValue={task.title}
          maxLength={200}
          aria-label="任务标题"
          className="h-9 border-transparent px-1 text-lg font-semibold hover:border-border focus:border-border"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== task.title) save({ title: v });
            else if (!v) e.target.value = task.title; // 空标题不落库，还原
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      ) : (
        <h2 className="px-1 text-lg font-semibold">{task.title}</h2>
      )}

      {/* 字段区 */}
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-1 text-[13px]">
        <dt className="text-xs text-muted-foreground">负责人</dt>
        <dd>
          <AssigneePicker
            members={members ?? []}
            value={task.assignee_id}
            disabled={!canWrite}
            onChange={(userId) => save({ assignee_id: userId })}
          />
        </dd>

        <dt className="text-xs text-muted-foreground">优先级</dt>
        <dd>
          <Select
            value={task.priority}
            disabled={!canWrite}
            aria-label="优先级"
            className="w-32"
            onChange={(e) => save({ priority: e.target.value as Priority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_TEXT[p]}
              </option>
            ))}
          </Select>
        </dd>

        <dt className="text-xs text-muted-foreground">截止</dt>
        <dd>
          <Input
            type="datetime-local"
            key={`due:${task.updated_at}`}
            defaultValue={toLocalInputValue(task.due_at)}
            disabled={!canWrite}
            aria-label="截止时间"
            className="w-56"
            onBlur={(e) => {
              const iso = fromLocalInputValue(e.target.value);
              if (iso !== task.due_at) save({ due_at: iso });
            }}
          />
        </dd>

        <dt className="text-xs text-muted-foreground">提醒</dt>
        <dd>
          <Input
            type="datetime-local"
            key={`remind:${task.updated_at}`}
            defaultValue={toLocalInputValue(task.remind_at)}
            disabled={!canWrite}
            aria-label="提醒时间"
            className="w-56"
            onBlur={(e) => {
              const iso = fromLocalInputValue(e.target.value);
              if (iso !== task.remind_at) save({ remind_at: iso });
            }}
          />
        </dd>

        <dt className="flex items-center gap-1 text-xs text-muted-foreground">
          <Repeat className="h-3 w-3" /> 重复
        </dt>
        <dd className="flex items-center gap-2">
          <Select
            value={recurrence?.freq ?? ""}
            disabled={!canWrite}
            aria-label="重复规则"
            className="w-32"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") save({ recurrence: null });
              else
                save({
                  recurrence: { freq: v as RecurrenceFreq, interval: recurrence?.interval ?? 1 },
                });
            }}
          >
            <option value="">不重复</option>
            {RECURRENCE_FREQS.map((f) => (
              <option key={f} value={f}>
                {RECURRENCE_TEXT[f]}
              </option>
            ))}
          </Select>
          {recurrence ? (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              每
              <Input
                type="number"
                min={1}
                max={99}
                key={`interval:${task.updated_at}`}
                defaultValue={recurrence.interval}
                disabled={!canWrite}
                aria-label="重复间隔"
                className="h-7 w-16 text-xs"
                onBlur={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(n) && n >= 1 && n <= 99 && n !== recurrence.interval) {
                    save({ recurrence: { freq: recurrence.freq, interval: n } });
                  }
                }}
              />
              {recurrence.freq === "daily" ? "天" : recurrence.freq === "weekly" ? "周" : "个月"}
            </label>
          ) : null}
        </dd>

        <dt className="text-xs text-muted-foreground">所属清单</dt>
        <dd className="text-muted-foreground">
          {lists?.find((l) => l.id === task.list_id)?.name ?? "—"}
        </dd>
      </dl>

      {/* 描述 */}
      <section aria-label="任务描述" className="space-y-1 px-1">
        <h3 className="text-[13px] font-medium">描述</h3>
        {canWrite ? (
          <Textarea
            key={`desc:${task.updated_at}`}
            defaultValue={task.description ?? ""}
            placeholder="补充任务描述…"
            maxLength={10000}
            aria-label="任务描述"
            onBlur={(e) => {
              const v = e.target.value;
              const normalized = v === "" ? null : v;
              if (normalized !== task.description) save({ description: normalized });
            }}
          />
        ) : (
          <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
            {task.description || "（无描述）"}
          </p>
        )}
      </section>

      <SubtaskChecklist taskId={task.id} canWrite={canWrite} />

      <section aria-label="讨论区" className="space-y-3 px-1">
        <h3 className="text-[13px] font-medium">讨论</h3>
        <CommentSection taskId={task.id} members={members ?? []} canWrite={canWrite} />
      </section>

      {/* 删除确认 */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle>删除任务</DialogTitle>
          <p className="mt-2 text-[13px] text-muted-foreground">
            确定删除任务「{task.title}」吗？删除后可在回收站恢复（30 天）。
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTask.isPending}
              onClick={() => deleteTask.mutate(task)}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
