import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import { ApiError } from "@doughpie/api-client";
import { COPY, type CursorPage, type Task, type UpdateTaskBody } from "@doughpie/shared";
import { toast } from "sonner";
import { api } from "../lib/api";
import { errorMessage } from "../lib/api-error";

interface UpdateTaskVars {
  id: string;
  body: UpdateTaskBody;
  /** 乐观锁版本（If-Match），冲突 409 强制 refetch */
  version: number;
}

interface RollbackCtx {
  prevTask: Task | undefined;
  prevLists: [QueryKey, InfiniteData<CursorPage<Task>> | undefined][];
}

/** 无限分页缓存中就地更新某个任务（乐观更新用） */
function patchInfinite(
  data: InfiniteData<CursorPage<Task>>,
  taskId: string,
  body: UpdateTaskBody,
): InfiniteData<CursorPage<Task>> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((t) => (t.id === taskId ? ({ ...t, ...body } as Task) : t)),
    })),
  };
}

/**
 * 任务更新 mutation（web.md §3 乐观更新约定）：
 * 先写缓存（['task',id] 详情 + 所有 ['tasks',…] 列表）→ 失败回滚 →
 * 409 VERSION_CONFLICT 强制 refetch + 提示「已被他人修改」。
 */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, version }: UpdateTaskVars) => api.tasks.update(id, body, version),
    onMutate: async (vars): Promise<RollbackCtx> => {
      await qc.cancelQueries({ queryKey: ["task", vars.id] });
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prevTask = qc.getQueryData<Task>(["task", vars.id]);
      if (prevTask) {
        qc.setQueryData<Task>(["task", vars.id], { ...prevTask, ...vars.body } as Task);
      }
      const prevLists = qc.getQueriesData<InfiniteData<CursorPage<Task>>>({
        queryKey: ["tasks"],
      });
      for (const [key, data] of prevLists) {
        if (data) qc.setQueryData(key, patchInfinite(data, vars.id, vars.body));
      }
      return { prevTask, prevLists };
    },
    onError: (err, vars, ctx) => {
      // 回滚乐观写入
      if (ctx?.prevTask) qc.setQueryData(["task", vars.id], ctx.prevTask);
      for (const [key, data] of ctx?.prevLists ?? []) qc.setQueryData(key, data);
      if (err instanceof ApiError && err.isConflict) {
        toast.error(COPY.common.versionConflict);
      } else {
        toast.error(errorMessage(err));
      }
      // 冲突（及任何失败）后强制 refetch 拿最新 version
      void qc.invalidateQueries({ queryKey: ["task", vars.id] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ["task", vars.id] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
