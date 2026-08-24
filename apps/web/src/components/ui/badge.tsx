import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/**
 * 徽章（ui.md §8 业务语义视觉映射）：
 * - state-*：任务四态（review 即「待验收」徽章）
 * - notify-*：通知三级 🔴🟠⚪
 * - mention-*：提及确认 chips
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium leading-4",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        outline: "border border-border text-muted-foreground",
        "state-todo": "bg-muted text-state-todo",
        "state-doing": "bg-muted text-state-doing",
        "state-review": "bg-muted text-state-review",
        "state-done": "bg-muted text-state-done",
        "notify-high": "bg-muted text-notify-high",
        "notify-mid": "bg-muted text-notify-mid",
        "notify-low": "bg-muted text-notify-low",
        "mention-pending": "bg-muted text-mention-pending",
        "mention-acked": "bg-muted text-mention-acked",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
