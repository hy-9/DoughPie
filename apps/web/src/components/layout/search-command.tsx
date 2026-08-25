import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCurrentWorkspace } from "../../hooks/use-current-workspace";
import { useLists } from "../../hooks/use-lists";
import { api } from "../../lib/api";
import { TASK_STATUS_TEXT } from "../../lib/labels";
import { StatusDot } from "../task/task-status-badge";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

/**
 * Ctrl+K 搜索命令面板（web.md §7，P0-11）：
 * 输入即查（服务端 ILIKE 标题+描述，300ms 防抖），结果行显所属清单+状态徽章，回车/点击跳详情抽屉。
 */
export function SearchCommand({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const { workspace } = useCurrentWorkspace();
  const wsId = workspace?.id;
  const { data: lists } = useLists(wsId);
  const navigate = useNavigate();
  const location = useLocation();

  // 防抖：输入停顿 300ms 后才发查询，避免逐键打满接口
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // 关闭后清空，重开是全新搜索
  useEffect(() => {
    if (!open) {
      setQ("");
      setDebounced("");
    }
  }, [open]);

  const listNameById = useMemo(() => new Map((lists ?? []).map((l) => [l.id, l.name])), [lists]);

  const search = useQuery({
    queryKey: ["tasks", wsId, { q: debounced, limit: 20 }],
    queryFn: () => api.tasks.list(wsId as string, { q: debounced, limit: 20 }),
    enabled: open && !!wsId && debounced.length > 0,
  });

  const items = search.data?.items ?? [];

  const openTask = (taskId: string) => {
    onOpenChange(false);
    // 面板也是「看板/列表内」入口的一种：以抽屉形态打开（ui.md §1）
    navigate(`/task/${taskId}`, { state: { background: location } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[15%] max-w-lg -translate-y-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">搜索任务</DialogTitle>
        <Command shouldFilter={false} label="搜索任务">
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="搜索任务标题或描述…"
            aria-label="搜索关键词"
          />
          <CommandList>
            {debounced.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                输入关键词开始搜索
              </div>
            ) : null}
            {debounced.length > 0 && !search.isLoading && items.length === 0 ? (
              <CommandEmpty>没有匹配的任务</CommandEmpty>
            ) : null}
            {items.map((t) => (
              <CommandItem key={t.id} value={t.id} onSelect={() => openTask(t.id)}>
                <StatusDot status={t.status} />
                <span className="truncate">{t.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {listNameById.get(t.list_id) ?? ""} · {TASK_STATUS_TEXT[t.status]}
                </span>
              </CommandItem>
            ))}
            {search.isLoading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">搜索中…</div>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
