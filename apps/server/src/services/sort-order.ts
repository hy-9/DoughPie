import { SORT_GAP } from "@doughpie/shared";

/**
 * 排序间隙算法（backend.md §3）：相邻项 sort_order 间距 1000，插入取中位。
 * 排序冲突接受后写者胜（PLAN.md §4，无乐观锁）；间隙耗尽（<1）时整列重排。
 *
 * 纯函数，不触库；调用方（list/task service）负责在事务内读取邻居值与落库。
 */

/**
 * 计算插入落点的 sort_order。
 * @param prev 落点前一项的 sort_order（插入头部传 null）
 * @param next 落点后一项的 sort_order（插入尾部传 null）
 * @returns 新的 sort_order；null = 间隙耗尽，调用方需先整列重排再重算
 */
export function gapInsertOrder(prev: number | null, next: number | null): number | null {
  // 头部（含空列）：first - 1000；不足 1 时退化为 first / 2；仍不足 1 则需重排
  if (prev === null) {
    if (next === null) return SORT_GAP;
    const candidate = next - SORT_GAP;
    if (candidate >= 1) return candidate;
    const halved = next / 2;
    return halved >= 1 ? halved : null;
  }
  // 尾部：max + 1000
  if (next === null) return prev + SORT_GAP;
  // 中间：两端取中位；间隙 <1 触发重排
  const gap = next - prev;
  if (gap < 1) return null;
  return prev + gap / 2;
}

/**
 * 整列重排值序列：1000, 2000, ...（调用方按现有相对顺序按下标赋回各项）。
 */
export function resequencedOrders(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * SORT_GAP);
}
