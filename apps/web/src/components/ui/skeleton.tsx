import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/** 骨架屏（ui.md §6：加载态统一 Skeleton，不做插画） */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
