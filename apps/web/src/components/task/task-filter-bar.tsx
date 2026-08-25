import type { Member, Priority, TaskStatus } from "@doughpie/shared";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { useMembers } from "../../hooks/use-members";
import type { TaskFilters } from "../../hooks/use-tasks-query";
import { PRIORITY_TEXT, TASK_STATUS_TEXT } from "../../lib/labels";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";

/** 列表/智能视图筛选条状态（UI 态，受控于页面组件） */
export interface FilterValue {
  assigneeId: string;
  status: "" | TaskStatus;
  priority: "" | Priority;
  dueFrom: string;
  dueTo: string;
  sort: "sort_order" | "due_at" | "priority" | "created_at" | "updated_at";
  order: "asc" | "desc";
}

export const DEFAULT_FILTER: FilterValue = {
  assigneeId: "",
  status: "",
  priority: "",
  dueFrom: "",
  dueTo: "",
  sort: "sort_order",
  order: "asc",
};

/** 筛选条状态 → 任务查询参数（四筛 + 排序，P0-15；日期区间按本地天换算 UTC ISO） */
export function toTaskFilters(f: FilterValue): TaskFilters {
  return {
    assignee_id: f.assigneeId || undefined,
    status: f.status || undefined,
    priority: f.priority || undefined,
    due_from: f.dueFrom ? new Date(`${f.dueFrom}T00:00:00`).toISOString() : undefined,
    due_to: f.dueTo ? new Date(`${f.dueTo}T23:59:59.999`).toISOString() : undefined,
    sort: f.sort,
    order: f.order,
  };
}

/**
 * 四筛 + 排序切换（P0-15）：负责人/状态/优先级/截止区间 + 排序键 + 升降序。
 * 原生 select 保键盘可达；viewer 也可筛选（读动作）。
 */
export function TaskFilterBar({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: FilterValue;
  onChange: (next: FilterValue) => void;
}) {
  const { data: members } = useMembers(workspaceId);

  const set = <K extends keyof FilterValue>(key: K, v: FilterValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.assigneeId}
        onChange={(e) => set("assigneeId", e.target.value)}
        aria-label="按负责人筛选"
        className="h-7 w-28 text-xs"
      >
        <option value="">全部负责人</option>
        {(members ?? []).map((m: Member) => (
          <option key={m.user_id} value={m.user_id}>
            {m.display_name}
          </option>
        ))}
      </Select>
      <Select
        value={value.status}
        onChange={(e) => set("status", e.target.value as FilterValue["status"])}
        aria-label="按状态筛选"
        className="h-7 w-24 text-xs"
      >
        <option value="">全部状态</option>
        {(Object.keys(TASK_STATUS_TEXT) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_TEXT[s]}
          </option>
        ))}
      </Select>
      <Select
        value={value.priority}
        onChange={(e) => set("priority", e.target.value as FilterValue["priority"])}
        aria-label="按优先级筛选"
        className="h-7 w-24 text-xs"
      >
        <option value="">全部优先级</option>
        {(Object.keys(PRIORITY_TEXT) as Priority[]).map((p) => (
          <option key={p} value={p}>
            {PRIORITY_TEXT[p]}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        截止
        <Input
          type="date"
          value={value.dueFrom}
          onChange={(e) => set("dueFrom", e.target.value)}
          aria-label="截止日期从"
          className="h-7 w-36 text-xs"
        />
        ~
        <Input
          type="date"
          value={value.dueTo}
          onChange={(e) => set("dueTo", e.target.value)}
          aria-label="截止日期至"
          className="h-7 w-36 text-xs"
        />
      </label>
      <div className="ml-auto flex items-center gap-1">
        <Select
          value={value.sort}
          onChange={(e) => set("sort", e.target.value as FilterValue["sort"])}
          aria-label="排序键"
          className="h-7 w-28 text-xs"
        >
          <option value="sort_order">手动排序</option>
          <option value="due_at">按截止</option>
          <option value="priority">按优先级</option>
          <option value="created_at">按创建</option>
          <option value="updated_at">按更新</option>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => set("order", value.order === "asc" ? "desc" : "asc")}
          aria-label={value.order === "asc" ? "当前升序，点击切换降序" : "当前降序，点击切换升序"}
        >
          {value.order === "asc" ? (
            <ArrowUpNarrowWide className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
