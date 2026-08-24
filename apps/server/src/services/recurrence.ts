import type { RecurrenceRule } from "@doughpie/shared";

/**
 * 重复任务引擎（backend.md §4）：纯函数计算下一次计划时间。
 * - 基准 = 计划时间（scheduledAt = 上一次实例的 due_at），非完成时间
 * - 仅 status 进入 done 时由 service 层触发（review 不算完成）；到点不自动生成
 * - monthly 月末 clamp（1/31 → 2/28|29），clamp 结果即下一次的基准（粘性）
 * - until：下一次 > until → null（等于仍生成）
 * - 全程 UTC：一律用 getUTC 系列与 Date.UTC 运算，无 DST 问题
 */

const DAY_MS = 24 * 3600 * 1000;

/** UTC 日历日加减（UTC 无 DST，毫秒平移即日历日平移） */
function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** UTC 当天 00:00 */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** 所在周的周日 00:00 UTC（周起点 = 周日，与 by_weekday 的 0=周日对齐） */
function startOfUtcWeek(date: Date): Date {
  const day = startOfUtcDay(date);
  return addUtcDays(day, -day.getUTCDay());
}

/** 把 base 的 UTC 时刻（时分秒毫秒）贴到 day 这一天 */
function withTimeOfDay(day: Date, base: Date): Date {
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

/** 某 UTC 年月的天数（month 从 0 计） */
function daysInUtcMonth(year: number, month0: number): number {
  // 次月第 0 天 = 当月最后一天
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** monthly：+interval 月，目标月天数不足时 clamp 到月末（1/31 → 2/28|29） */
function addUtcMonthsClamped(base: Date, months: number): Date {
  const totalMonth = base.getUTCMonth() + months;
  const targetYear = base.getUTCFullYear() + Math.floor(totalMonth / 12);
  const targetMonth = totalMonth % 12;
  const day = Math.min(base.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

/** weekly：无 by_weekday 时 +interval 周；有则在「间隔周」内取下一个命中日（保持时刻） */
function nextWeekly(rule: RecurrenceRule, base: Date): Date | null {
  const interval = rule.interval;
  if (!rule.by_weekday) return addUtcDays(base, interval * 7);
  // 锚定 base 所在周为第 0 周；每 interval 周为一个「on 周」，周内命中 by_weekday 的日子均可
  const anchorWeekStart = startOfUtcWeek(base);
  // 上界足够覆盖最坏情况（interval 最大 99，必在 interval*7+7 天内命中）
  const maxScanDays = interval * 7 + 7;
  let day = addUtcDays(startOfUtcDay(base), 1);
  for (let i = 0; i < maxScanDays; i++) {
    if (rule.by_weekday.includes(day.getUTCDay())) {
      const weeksDiff = Math.round(
        (startOfUtcWeek(day).getTime() - anchorWeekStart.getTime()) / (7 * DAY_MS),
      );
      if (weeksDiff % interval === 0) return withTimeOfDay(day, base);
    }
    day = addUtcDays(day, 1);
  }
  // 理论不可达（by_weekday 非空且 interval 有限必有解）；保底返回 null 而非死循环
  return null;
}

/**
 * 计算下一次计划时间。
 * @param rule 重复规则（shared 契约：freq/interval/by_weekday?/until?）
 * @param scheduledAt 基准 = 上一次实例的计划时间（due_at）
 * @returns 下一次计划时间；规则到期（until）返回 null
 */
export function nextOccurrence(rule: RecurrenceRule, scheduledAt: Date): Date | null {
  let next: Date | null;
  switch (rule.freq) {
    case "daily":
      next = addUtcDays(scheduledAt, rule.interval);
      break;
    case "weekly":
      next = nextWeekly(rule, scheduledAt);
      break;
    case "monthly":
      next = addUtcMonthsClamped(scheduledAt, rule.interval);
      break;
  }
  if (next === null) return null;
  // until：超过即不再生成；等于仍生成
  if (rule.until !== undefined && next.getTime() > new Date(rule.until).getTime()) return null;
  return next;
}
