import { cn } from "../lib/utils";

/**
 * 用户头像（PLAN.md §8 + ui.md §3.4）：
 * P0 按 username 哈希生成色块+首字符；色取 avatar-1..10 语义 token（随主题可调，生成逻辑不变）。
 */

/** 稳定哈希：同一 username 永远落同一色板槽位 */
function hashSlot(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = (h * 31 + username.charCodeAt(i)) >>> 0;
  }
  return (h % 10) + 1;
}

interface UserAvatarProps {
  username: string;
  displayName?: string;
  size?: "sm" | "default";
  className?: string;
}

export function UserAvatar({
  username,
  displayName,
  size = "default",
  className,
}: UserAvatarProps) {
  const slot = hashSlot(username);
  const initial = (displayName || username).slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white",
        size === "sm" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs",
        className,
      )}
      // 色板槽位来自 token（--avatar-1..10），不是硬编码色值
      style={{ backgroundColor: `var(--avatar-${slot})` }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
