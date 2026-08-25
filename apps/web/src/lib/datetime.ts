/**
 * 时间显示工具（PLAN.md §8：UTC 存储 + 设备本地时区显示；中文文案）。
 * 无第三方依赖：Intl.RelativeTimeFormat + Intl.DateTimeFormat。
 */

const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

/** 本地零点（用于「今天/明天」日历天比较） */
function startOfDay(x: Date): number {
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

/** 相对时间：x 分钟前 / x 小时前 / x 天前；超过 30 天回落绝对日期 */
export function formatRelative(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const diffSec = Math.round((time - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.trunc(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.trunc(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.trunc(diffSec / 86400), "day");
  return formatDate(iso);
}

/** 绝对日期时间（本地时区）：2026/08/25 14:30 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** 仅日期：2026/08/25 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 截止时间展示：今天 14:30 / 明天 / 08/28 / 2026/08/28（跨年） */
export function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  const hm = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (dayDiff === 0) return hasTime ? `今天 ${hm}` : "今天";
  if (dayDiff === 1) return hasTime ? `明天 ${hm}` : "明天";
  if (dayDiff === -1) return hasTime ? `昨天 ${hm}` : "昨天";
  if (d.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(d);
  }
  return formatDate(iso);
}

/** 是否已逾期（due_at 早于现在且任务未完成时由调用方组合判断） */
export function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/** 仅时间：14:32（提及确认 chips 等场景） */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** 补零（模块级，避免每次调用重建） */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO 串 → <input type="datetime-local"> 值（本地时区 yyyy-MM-ddTHH:mm；空值 → 空串） */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** datetime-local 值 → ISO 串（本地时区转 UTC；空串/非法 → null） */
export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
