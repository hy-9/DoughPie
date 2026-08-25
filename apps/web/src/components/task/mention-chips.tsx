import type { CommentMention } from "@doughpie/shared";
import { formatTime } from "../../lib/datetime";
import { Badge } from "../ui/badge";

/**
 * 提及确认 chips（PLAN.md §5.5 闭环展示）：
 * 已确认 → 绿（mention-acked）：@B ✓已确认 14:32；待确认 → 琥珀（mention-pending）：@D ⏳待确认。
 * 发起者（评论作者）可对未确认提及「再提醒」（24h 节流，429 由调用方提示）。
 */
export function MentionChips({
  mentions,
  canRemind,
  remindingUserId,
  onRemind,
}: {
  mentions: CommentMention[];
  canRemind?: boolean;
  remindingUserId?: string | null;
  onRemind?: (userId: string) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="mention-chips">
      {mentions.map((m) =>
        m.acked_at ? (
          <Badge key={m.user_id} variant="mention-acked">
            @{m.display_name} ✓已确认 {formatTime(m.acked_at)}
          </Badge>
        ) : (
          <Badge key={m.user_id} variant="mention-pending">
            @{m.display_name} ⏳待确认
            {canRemind && onRemind ? (
              <button
                type="button"
                className="ml-1 rounded underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={remindingUserId === m.user_id}
                onClick={() => onRemind(m.user_id)}
              >
                再提醒
              </button>
            ) : null}
          </Badge>
        ),
      )}
    </div>
  );
}
