import { describe, expect, it } from "vitest";
import { TASK_STATUSES } from "../enums.js";
import {
  createTaskBodySchema,
  recurrenceRuleSchema,
  taskQuerySchema,
  updateTaskBodySchema,
} from "./task.js";

describe("任务契约", () => {
  it("标题 200 字符可通过，201 字符拒绝", () => {
    const base = { list_id: crypto.randomUUID(), title: "a".repeat(200) };
    expect(createTaskBodySchema.safeParse(base).success).toBe(true);
    expect(createTaskBodySchema.safeParse({ ...base, title: "a".repeat(201) }).success).toBe(false);
  });

  it("描述 10000 字符可通过，超长拒绝", () => {
    const base = { list_id: crypto.randomUUID(), title: "t", description: "d".repeat(10000) };
    expect(createTaskBodySchema.safeParse(base).success).toBe(true);
    expect(
      createTaskBodySchema.safeParse({ ...base, description: "d".repeat(10001) }).success,
    ).toBe(false);
  });

  it("状态枚举为预埋四态 {todo, doing, review, done}", () => {
    expect(TASK_STATUSES).toEqual(["todo", "doing", "review", "done"]);
    for (const s of TASK_STATUSES) {
      expect(updateTaskBodySchema.safeParse({ status: s }).success).toBe(true);
    }
    expect(updateTaskBodySchema.safeParse({ status: "archived" }).success).toBe(false);
  });

  it("更新体全空应拒绝（至少修改一项）", () => {
    expect(updateTaskBodySchema.safeParse({}).success).toBe(false);
  });

  it("priority 缺省为 none", () => {
    const parsed = createTaskBodySchema.parse({ list_id: crypto.randomUUID(), title: "t" });
    expect(parsed.priority).toBe("none");
  });
});

describe("重复规则契约", () => {
  it("daily/weekly/monthly 三频可用，interval 默认 1", () => {
    for (const freq of ["daily", "weekly", "monthly"] as const) {
      const r = recurrenceRuleSchema.parse({ freq });
      expect(r.interval).toBe(1);
    }
  });

  it("by_weekday 仅 weekly 可用", () => {
    expect(recurrenceRuleSchema.safeParse({ freq: "weekly", by_weekday: [1, 3, 5] }).success).toBe(
      true,
    );
    expect(recurrenceRuleSchema.safeParse({ freq: "daily", by_weekday: [1] }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({ freq: "monthly", by_weekday: [1] }).success).toBe(
      false,
    );
  });

  it("interval 范围 1~99，周几范围 0~6", () => {
    expect(recurrenceRuleSchema.safeParse({ freq: "daily", interval: 0 }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({ freq: "daily", interval: 100 }).success).toBe(false);
    expect(recurrenceRuleSchema.safeParse({ freq: "weekly", by_weekday: [7] }).success).toBe(false);
  });
});

describe("任务查询契约（智能视图 + 四筛）", () => {
  it("支持 today/mine/overdue 三种智能视图", () => {
    for (const view of ["today", "mine", "overdue"] as const) {
      expect(taskQuerySchema.safeParse({ view }).success).toBe(true);
    }
    expect(taskQuerySchema.safeParse({ view: "all" }).success).toBe(false);
  });

  it("status 支持单值与数组两种形态", () => {
    expect(taskQuerySchema.safeParse({ status: "todo" }).success).toBe(true);
    expect(taskQuerySchema.safeParse({ status: ["todo", "doing"] }).success).toBe(true);
  });

  it("limit 默认 50，上限 100", () => {
    expect(taskQuerySchema.parse({}).limit).toBe(50);
    expect(taskQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
