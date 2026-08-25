import type { Member } from "@doughpie/shared";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { UserAvatar } from "../user-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * 负责人选择器（任务详情字段区）：工作区成员列表，可置「未分配」（assignee_id=null）。
 * 轻量 Popover 实现；viewer 传 disabled 只读展示。
 */
export function AssigneePicker({
  members,
  value,
  onChange,
  disabled,
}: {
  members: Member[];
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = members.find((m) => m.user_id === value);

  const pick = (userId: string | null) => {
    onChange(userId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-card px-2 text-[13px] transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="负责人"
        >
          {current ? (
            <>
              <UserAvatar
                username={current.username}
                displayName={current.display_name}
                size="sm"
              />
              <span className="truncate">{current.display_name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">未分配</span>
          )}
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <button
          type="button"
          onClick={() => pick(null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          未分配
          {value === null ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
        </button>
        {members.map((m) => (
          <button
            key={m.user_id}
            type="button"
            onClick={() => pick(m.user_id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserAvatar username={m.username} displayName={m.display_name} size="sm" />
            <span className="truncate">{m.display_name}</span>
            <span className="truncate text-xs text-muted-foreground">@{m.username}</span>
            {m.user_id === value ? <Check className="ml-auto h-3.5 w-3.5 shrink-0" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
