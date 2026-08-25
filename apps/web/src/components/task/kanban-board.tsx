import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { List, Member, TaskStatus, Workspace } from "@doughpie/shared";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useLists } from "../../hooks/use-lists";
import { useMembers, useMyRole } from "../../hooks/use-members";
import { useTasksQuery } from "../../hooks/use-tasks-query";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/api-error";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { TaskCard } from "./task-card";

/**
 * 看板（P0-8）：三列渲染（§6.2 四态预埋：review 归入「进行中」列，卡片带「待验收」徽章）。
 * 不做拖拽（D 阶段 dnd-kit 接入点：列容器即未来的 Droppable）；状态流转在详情抽屉内完成。
 */
interface ColumnDef {
  key: string;
  title: string;
  status: TaskStatus[];
  /** done 列：折叠「最近 20 条 + 查看全部」，按更新时间倒序近似「最近完成」 */
  isDone?: boolean;
  /** 该列新建任务落地后的状态（创建契约不含 status，需补一次流转） */
  createAs?: TaskStatus;
}

const COLUMNS: ColumnDef[] = [
  { key: "todo", title: "待办", status: ["todo"] },
  { key: "doing", title: "进行中", status: ["doing", "review"], createAs: "doing" },
  { key: "done", title: "已完成", status: ["done"], isDone: true },
];

export function KanbanBoard({ workspace }: { workspace: Workspace }) {
  const { data: members } = useMembers(workspace.id);
  const { data: lists } = useLists(workspace.id);
  // viewer 只读：隐藏列头新建入口（服务端 403 兜底）
  const canWrite = useMyRole(workspace.id) !== "viewer";

  return (
    <div className="flex items-start gap-3 overflow-x-auto p-4">
      {COLUMNS.map((col) => (
        <BoardColumn
          key={col.key}
          def={col}
          workspaceId={workspace.id}
          members={members}
          lists={lists ?? []}
          canWrite={canWrite}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  def,
  workspaceId,
  members,
  lists,
  canWrite,
}: {
  def: ColumnDef;
  workspaceId: string;
  members: Member[] | undefined;
  lists: List[];
  canWrite: boolean;
}) {
  const [showAllDone, setShowAllDone] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const query = useTasksQuery(workspaceId, {
    status: def.status,
    sort: def.isDone ? "updated_at" : "sort_order",
    order: def.isDone ? "desc" : "asc",
    limit: def.isDone ? (showAllDone ? 50 : 20) : 50,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  // 抽屉形态打开（ui.md §1）：带 background state 导航，背景页保持挂载
  const open = (taskId: string) => navigate(`/task/${taskId}`, { state: { background: location } });

  return (
    <section className="w-72 shrink-0 rounded-lg bg-kanban p-2" aria-label={`${def.title}列`}>
      <header className="flex items-center gap-1 px-1 pb-2">
        <h2 className="text-[13px] font-medium">{def.title}</h2>
        <span className="tnum text-xs text-muted-foreground">{items.length}</span>
        {!def.isDone && canWrite ? (
          <CreateTaskPopover
            workspaceId={workspaceId}
            lists={lists}
            createAs={def.createAs}
            columnTitle={def.title}
          />
        ) : null}
      </header>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <div className="px-1 py-4 text-center">
          <p className="text-xs text-muted-foreground">加载失败</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">暂无任务</p>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <TaskCard key={t.id} task={t} members={members} onOpen={open} />
          ))}
        </div>
      )}

      {/* done 列折叠：最近 20 条 + 查看全部；其余列 50/页 + 加载更多 */}
      {def.isDone && !showAllDone && query.data?.pages[0]?.next_cursor ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-xs"
          onClick={() => setShowAllDone(true)}
        >
          查看全部
        </Button>
      ) : null}
      {(!def.isDone || showAllDone) && query.hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-xs"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "加载中…" : "加载更多"}
        </Button>
      ) : null}
    </section>
  );
}

/** 列头新建任务（P0-4）：标题 + 目标清单；「进行中」列创建后补一次状态流转（创建契约不含 status） */
function CreateTaskPopover({
  workspaceId,
  lists,
  createAs,
  columnTitle,
}: {
  workspaceId: string;
  lists: List[];
  createAs?: TaskStatus;
  columnTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState<string>("");
  const qc = useQueryClient();
  const effectiveListId = listId || lists[0]?.id || "";

  const create = useMutation({
    mutationFn: async (t: string) => {
      // priority 在契约输出类型中必填（zod default 后的形态），显式给 none
      const task = await api.tasks.create(workspaceId, {
        list_id: effectiveListId,
        title: t,
        priority: "none",
      });
      // 目标列非 todo 时补流转（乐观锁 version 从创建响应取）
      if (createAs && task.status !== createAs) {
        await api.tasks.update(task.id, { status: createAs }, task.version);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      setTitle("");
      setOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (t && effectiveListId) create.mutate(t);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`在${columnTitle}列新建任务`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-2" align="start">
        <form onSubmit={submit} className="space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="任务标题，回车创建"
            maxLength={200}
            autoFocus
            aria-label="任务标题"
          />
          <div className="flex items-center gap-2">
            <Select
              value={effectiveListId}
              onChange={(e) => setListId(e.target.value)}
              aria-label="所属清单"
              className="h-7 flex-1 text-xs"
            >
              {lists.length === 0 ? <option value="">（先创建清单）</option> : null}
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              size="sm"
              disabled={create.isPending || title.trim().length === 0 || !effectiveListId}
            >
              创建
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
