import { describe, expect, it } from "vitest";
import { SORT_GAP } from "@doughpie/shared";
import { gapInsertOrder, resequencedOrders } from "./sort-order.js";

/**
 * L1 排序间隙算法（backend.md §3：SORT_GAP=1000；落点两端取中位；
 * 头部=最小/2 或 first-1000；尾部=max+1000；间隙 <1 时重排整列）。
 */

describe("排序间隙算法（L1）", () => {
  it("空列插入 → 初始间隙值 1000", () => {
    expect(gapInsertOrder(null, null)).toBe(SORT_GAP);
  });

  it("插入尾部 → max + 1000", () => {
    expect(gapInsertOrder(1000, null)).toBe(2000);
    expect(gapInsertOrder(3500, null)).toBe(4500);
  });

  it("插入头部：first - 1000 >= 1 时取 first - 1000", () => {
    expect(gapInsertOrder(null, 2000)).toBe(1000);
    expect(gapInsertOrder(null, 5000)).toBe(4000);
  });

  it("插入头部：first - 1000 < 1 时退化为 first / 2", () => {
    expect(gapInsertOrder(null, 1000)).toBe(500);
    expect(gapInsertOrder(null, 800)).toBe(400);
  });

  it("插入头部：first 本身已 < 2 时，first/2 仍 < 1 → 返回 null 触发整列重排", () => {
    expect(gapInsertOrder(null, 1)).toBeNull();
    expect(gapInsertOrder(null, 0.5)).toBeNull();
  });

  it("插入中间 → 两端取中位", () => {
    expect(gapInsertOrder(1000, 2000)).toBe(1500);
    expect(gapInsertOrder(1000, 3000)).toBe(2000);
  });

  it("连续向同一间隙插入会二分耗尽，间隙 <1 时返回 null（触发重排）", () => {
    // 从 [1000, 2000] 开始持续往 1000 之后插：1000→2000 间隙 1000，每次减半
    let prev = 1000;
    let next = 2000;
    const inserted: number[] = [];
    for (;;) {
      const mid = gapInsertOrder(prev, next);
      if (mid === null) break;
      inserted.push(mid);
      next = mid; // 新项落在 prev 之后，成为新的 next
    }
    // 1000→500→250→125→62.5→31.25→15.625→7.8125→3.90625→1.953125→0.9765625（<1 停止）
    expect(inserted).toHaveLength(10);
    expect(inserted[0]).toBe(1500);
    expect(inserted[9]).toBeCloseTo(1000.9765625);
    // 耗尽确认：最后的间隙 < 1
    expect(next - prev).toBeLessThan(1);
    expect(gapInsertOrder(prev, next)).toBeNull();
  });

  it("整列重排：回到 1000 的倍数等差序列", () => {
    expect(resequencedOrders(0)).toEqual([]);
    expect(resequencedOrders(1)).toEqual([1000]);
    expect(resequencedOrders(4)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("重排后按新值排序保持原相对顺序（调用方按旧顺序按下标赋值）", () => {
    // 旧顺序 [0.4, 0.6, 0.7]（间隙已耗尽），重排后按下标一一对应，顺序不变
    const oldOrders = [0.4, 0.6, 0.7];
    const fresh = resequencedOrders(oldOrders.length);
    const remapped = oldOrders.map((_, i) => fresh[i] ?? 0);
    // 严格递增即「顺序保持」的直接证明
    expect(remapped).toEqual([1000, 2000, 3000]);
  });
});
