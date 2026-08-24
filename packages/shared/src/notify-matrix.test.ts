import { describe, expect, it } from "vitest";
import { NOTIFICATION_LEVELS, NOTIFICATION_TYPES } from "./enums.js";
import {
  DEFAULT_LEVEL_PUSH_POLICY,
  DEFAULT_NOTIFICATION_RULES,
  requiresAck,
} from "./notify-matrix.js";

describe("通知矩阵（PLAN.md §5.1）", () => {
  it("七种通知类型都有默认规则，且等级合法", () => {
    for (const t of NOTIFICATION_TYPES) {
      const rule = DEFAULT_NOTIFICATION_RULES[t];
      expect(NOTIFICATION_LEVELS).toContain(rule.level);
    }
  });

  it("默认映射：mention/assigned/overdue 高，progress/due/system 中，incomplete 低", () => {
    expect(DEFAULT_NOTIFICATION_RULES.mention.level).toBe("high");
    expect(DEFAULT_NOTIFICATION_RULES.assigned.level).toBe("high");
    expect(DEFAULT_NOTIFICATION_RULES.overdue.level).toBe("high");
    expect(DEFAULT_NOTIFICATION_RULES.progress.level).toBe("mid");
    expect(DEFAULT_NOTIFICATION_RULES.due.level).toBe("mid");
    expect(DEFAULT_NOTIFICATION_RULES.system.level).toBe("mid");
    expect(DEFAULT_NOTIFICATION_RULES.incomplete.level).toBe("low");
  });

  it("提及永不自动已读（须点「收到」），progress 自动已读", () => {
    expect(requiresAck("mention")).toBe(true);
    expect(requiresAck("assigned")).toBe(false);
    expect(DEFAULT_NOTIFICATION_RULES.progress.readBehavior).toBe("auto");
  });

  it("mention/assigned/system 不可关闭，其余可关", () => {
    expect(DEFAULT_NOTIFICATION_RULES.mention.closable).toBe(false);
    expect(DEFAULT_NOTIFICATION_RULES.assigned.closable).toBe(false);
    expect(DEFAULT_NOTIFICATION_RULES.system.closable).toBe(false);
    expect(DEFAULT_NOTIFICATION_RULES.overdue.closable).toBe(true);
    expect(DEFAULT_NOTIFICATION_RULES.incomplete.closable).toBe(true);
  });

  it("等级决定推送：🔴 必推 / 🟠 可选 / ⚪ 仅站内", () => {
    expect(DEFAULT_LEVEL_PUSH_POLICY.high).toBe("push_required");
    expect(DEFAULT_LEVEL_PUSH_POLICY.mid).toBe("push_optional");
    expect(DEFAULT_LEVEL_PUSH_POLICY.low).toBe("inapp_only");
  });
});
