import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/**
 * 下拉选择（原生 select 封装：天然键盘可达/移动端友好；不引 @radix-ui/react-select 新依赖）。
 * 仅消费语义 token（ui.md §10 检查清单）。
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-8 rounded-lg border border-border bg-card px-2 text-[13px] text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
