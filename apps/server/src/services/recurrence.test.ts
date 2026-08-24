import { describe, expect, it } from "vitest";
import type { RecurrenceRule } from "@doughpie/shared";
import { nextOccurrence } from "./recurrence.js";

/**
 * L1 重复任务引擎（backend.md §4，PLAN.md §10 风险行：UTC + 测试先行 + 只支持三种 freq）。
 * 断言全部从规格推导：基准=计划时间（非完成时间）；monthly 月末 clamp；仅 done 触发
 * （触发在服务层，本模块只负责「下一次计划时间」）；until 等于=生成、超过=null；全程 UTC。
 */

const rule = (overrides: Partial<RecurrenceRule>): RecurrenceRule => ({
  freq: "daily",
  interval: 1,
  ...overrides,
});

describe("重复任务引擎 nextOccurrence（L1）", () => {
  describe("daily", () => {
    it("interval=1：+1 天，保持当日时刻", () => {
      const next = nextOccurrence(rule({ freq: "daily" }), new Date("2026-01-15T09:30:00.000Z"));
      expect(next?.toISOString()).toBe("2026-01-16T09:30:00.000Z");
    });

    it("interval=3：+3 天，跨月", () => {
      const next = nextOccurrence(
        rule({ freq: "daily", interval: 3 }),
        new Date("2026-01-30T08:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-02-02T08:00:00.000Z");
    });

    it("跨年份：2025-12-31 → 2026-01-01", () => {
      const next = nextOccurrence(rule({ freq: "daily" }), new Date("2025-12-31T23:00:00.000Z"));
      expect(next?.toISOString()).toBe("2026-01-01T23:00:00.000Z");
    });
  });

  describe("weekly", () => {
    it("无 by_weekday：+7 天（interval=1）", () => {
      const next = nextOccurrence(rule({ freq: "weekly" }), new Date("2026-08-03T10:00:00.000Z"));
      expect(next?.toISOString()).toBe("2026-08-10T10:00:00.000Z");
    });

    it("无 by_weekday：interval=2 → +14 天", () => {
      const next = nextOccurrence(
        rule({ freq: "weekly", interval: 2 }),
        new Date("2026-08-03T10:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-08-17T10:00:00.000Z");
    });

    it("by_weekday 多选：周一 → 同周周三（0=周日，UTC）", () => {
      // 2026-08-03 是周一
      const next = nextOccurrence(
        rule({ freq: "weekly", by_weekday: [1, 3, 5] }),
        new Date("2026-08-03T10:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-08-05T10:00:00.000Z");
    });

    it("by_weekday 跨周：周五 → 下周一", () => {
      // 2026-08-07 是周五
      const next = nextOccurrence(
        rule({ freq: "weekly", by_weekday: [1] }),
        new Date("2026-08-07T10:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-08-10T10:00:00.000Z");
    });

    it("by_weekday + interval=2：跳过下一周（隔周生效）", () => {
      const next = nextOccurrence(
        rule({ freq: "weekly", interval: 2, by_weekday: [1] }),
        new Date("2026-08-03T10:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-08-17T10:00:00.000Z");
    });

    it("by_weekday + interval=2：同一「间隔周」内的后续命中日仍可取", () => {
      // 周三 08-05 完成，本周是 on 周 → 周五 08-07；再继续则以周五为基准到 08-17（隔周周一）
      const first = nextOccurrence(
        rule({ freq: "weekly", interval: 2, by_weekday: [1, 3, 5] }),
        new Date("2026-08-05T10:00:00.000Z"),
      );
      expect(first?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
      const second = nextOccurrence(
        rule({ freq: "weekly", interval: 2, by_weekday: [1, 3, 5] }),
        first!,
      );
      expect(second?.toISOString()).toBe("2026-08-17T10:00:00.000Z");
    });

    it("by_weekday 保持基准时刻（时分秒毫秒）", () => {
      const next = nextOccurrence(
        rule({ freq: "weekly", by_weekday: [3] }),
        new Date("2026-08-03T10:30:15.123Z"),
      );
      expect(next?.toISOString()).toBe("2026-08-05T10:30:15.123Z");
    });

    it("by_weekday=[0]（周日）：周一 → 本周日", () => {
      const next = nextOccurrence(
        rule({ freq: "weekly", by_weekday: [0] }),
        new Date("2026-08-03T10:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-08-09T10:00:00.000Z");
    });
  });

  describe("monthly", () => {
    it("常规：+1 月，保持日与时刻", () => {
      const next = nextOccurrence(rule({ freq: "monthly" }), new Date("2026-01-15T09:00:00.000Z"));
      expect(next?.toISOString()).toBe("2026-02-15T09:00:00.000Z");
    });

    it("月末 clamp：1/31 → 2/28（平年 2026）", () => {
      const next = nextOccurrence(rule({ freq: "monthly" }), new Date("2026-01-31T12:00:00.000Z"));
      expect(next?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    });

    it("月末 clamp：1/31 → 2/29（闰年 2024）", () => {
      const next = nextOccurrence(rule({ freq: "monthly" }), new Date("2024-01-31T12:00:00.000Z"));
      expect(next?.toISOString()).toBe("2024-02-29T12:00:00.000Z");
    });

    it("clamp 后继续推进以 clamp 结果为新基准（1/31 → 2/28 → 3/28）", () => {
      const feb = nextOccurrence(rule({ freq: "monthly" }), new Date("2026-01-31T12:00:00.000Z"));
      expect(feb?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
      // 基准=上一次计划时间（已被 clamp 到 2/28），3 月落在 3/28 而非 3/31
      const mar = nextOccurrence(rule({ freq: "monthly" }), feb!);
      expect(mar?.toISOString()).toBe("2026-03-28T12:00:00.000Z");
    });

    it("interval=3 跨年且 clamp：2026-11-30 → 2027-02-28（平年）", () => {
      const next = nextOccurrence(
        rule({ freq: "monthly", interval: 3 }),
        new Date("2026-11-30T07:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2027-02-28T07:00:00.000Z");
    });

    it("interval=3 无需 clamp：2026-10-31 → 2027-01-31", () => {
      const next = nextOccurrence(
        rule({ freq: "monthly", interval: 3 }),
        new Date("2026-10-31T07:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2027-01-31T07:00:00.000Z");
    });

    it("12 月 +1 月跨年：2026-12-15 → 2027-01-15", () => {
      const next = nextOccurrence(rule({ freq: "monthly" }), new Date("2026-12-15T00:00:00.000Z"));
      expect(next?.toISOString()).toBe("2027-01-15T00:00:00.000Z");
    });
  });

  describe("until 边界", () => {
    it("下一次 == until → 仍生成（等于为合法边界）", () => {
      const next = nextOccurrence(
        rule({ freq: "daily", until: "2026-01-16T09:30:00.000Z" }),
        new Date("2026-01-15T09:30:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-01-16T09:30:00.000Z");
    });

    it("下一次 > until → null（不再生成）", () => {
      const next = nextOccurrence(
        rule({ freq: "daily", until: "2026-01-16T09:29:59.999Z" }),
        new Date("2026-01-15T09:30:00.000Z"),
      );
      expect(next).toBeNull();
    });

    it("until 在远未来 → 正常生成", () => {
      const next = nextOccurrence(
        rule({ freq: "monthly", until: "2027-06-01T00:00:00.000Z" }),
        new Date("2026-01-31T12:00:00.000Z"),
      );
      expect(next?.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    });
  });
});
