import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { List } from "@doughpie/shared";
import {
  AlarmClock,
  CalendarDays,
  MoreHorizontal,
  Plus,
  Settings,
  Settings2,
  UserCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCurrentWorkspace } from "../../hooks/use-current-workspace";
import { useLists } from "../../hooks/use-lists";
import { useMyRole } from "../../hooks/use-members";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/api-error";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";

const navBase =
  "flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const navActive = "bg-muted text-foreground font-medium";

/**
 * 左侧栏 240px（ui.md §5）：智能视图（今天/我负责的/已逾期）+ 清单树 + 底部设置。
 * viewer 只读降级：隐藏新建/重命名/删除入口（服务端仍 403 兜底）。
 */
export function Sidebar() {
  const { workspace } = useCurrentWorkspace();
  const wsId = workspace?.id;
  const { data: lists } = useLists(wsId);
  const myRole = useMyRole(wsId);
  const canWrite = myRole === "owner" || myRole === "member";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<List | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<List | null>(null);

  const createList = useMutation({
    mutationFn: (name: string) => api.lists.create(wsId as string, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lists", wsId] });
      setCreating(false);
      setNewName("");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const renameList = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.lists.update(id, { name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lists", wsId] });
      setEditing(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteList = useMutation({
    mutationFn: (id: string) => api.lists.remove(id),
    onSuccess: (_v, id) => {
      void qc.invalidateQueries({ queryKey: ["lists", wsId] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      setDeleting(null);
      // 正停留在被删清单页时回看板，避免空引用
      if (location.pathname === `/list/${id}`) navigate("/");
      toast.success("清单已删除");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (name) createList.mutate(name);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        <NavLink to="/today" className={({ isActive }) => cn(navBase, isActive && navActive)}>
          <CalendarDays className="h-4 w-4" /> 今天
        </NavLink>
        <NavLink to="/mine" className={({ isActive }) => cn(navBase, isActive && navActive)}>
          <UserCheck className="h-4 w-4" /> 我负责的
        </NavLink>
        <NavLink to="/overdue" className={({ isActive }) => cn(navBase, isActive && navActive)}>
          <AlarmClock className="h-4 w-4" /> 已逾期
        </NavLink>

        <div className="mt-4 flex items-center justify-between px-2 pb-1">
          <span className="text-xs font-medium text-muted-foreground">清单</span>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="新建清单"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <NavLink to="/" end className={({ isActive }) => cn(navBase, isActive && navActive)}>
          <span className="h-2 w-2 rounded-full bg-state-doing" aria-hidden /> 全部任务
        </NavLink>
        {(lists ?? []).map((l) => (
          <div key={l.id} className="group relative">
            <NavLink
              to={`/list/${l.id}`}
              className={({ isActive }) => cn(navBase, isActive && navActive, "pr-7")}
            >
              {/* 清单颜色为契约数据（自由 hex）；空值落默认色 token */}
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: l.color ?? "var(--priority-none)" }}
                aria-hidden
              />
              <span className="truncate">{l.name}</span>
            </NavLink>
            {canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-border focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    aria-label={`清单「${l.name}」操作`}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(l);
                      setEditName(l.name);
                    }}
                  >
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(l)}>
                    删除清单
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ))}
        {creating ? (
          <form onSubmit={submitCreate} className="px-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="清单名称，回车创建"
              maxLength={50}
              autoFocus
              aria-label="新清单名称"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              onBlur={() => {
                if (!createList.isPending) {
                  setCreating(false);
                  setNewName("");
                }
              }}
              className="h-7 text-xs"
            />
          </form>
        ) : null}
        {(lists ?? []).length === 0 && !creating ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">还没有清单</p>
        ) : null}
      </nav>

      <div className="space-y-0.5 border-t border-border p-2">
        {workspace ? (
          <NavLink
            to={`/ws/${workspace.id}/settings`}
            className={({ isActive }) => cn(navBase, isActive && navActive)}
          >
            <Settings2 className="h-4 w-4" /> 工作区设置
          </NavLink>
        ) : null}
        <NavLink to="/settings" className={({ isActive }) => cn(navBase, isActive && navActive)}>
          <Settings className="h-4 w-4" /> 个人设置
        </NavLink>
      </div>

      {/* 重命名对话框（单实例，避免每个清单挂一个） */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle>重命名清单</DialogTitle>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const name = editName.trim();
              if (editing && name) renameList.mutate({ id: editing.id, name });
            }}
          >
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={50}
              autoFocus
              aria-label="清单名称"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button type="submit" disabled={renameList.isPending || editName.trim().length === 0}>
                保存
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogTitle>删除清单</DialogTitle>
          <p className="mt-2 text-[13px] text-muted-foreground">
            确定删除清单「{deleting?.name}」吗？清单内任务将一并删除。
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteList.isPending}
              onClick={() => deleting && deleteList.mutate(deleting.id)}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
