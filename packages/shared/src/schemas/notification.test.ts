import { describe, expect, it } from "vitest";
import { notificationQuerySchema } from "./notification.js";

describe("通知查询契约", () => {
  it("unread_only 显式 true/false 字符串（query 反序列化）", () => {
    expect(notificationQuerySchema.parse({ unread_only: "true" }).unread_only).toBe(true);
    expect(notificationQuerySchema.parse({ unread_only: "false" }).unread_only).toBe(false);
    expect(notificationQuerySchema.parse({}).unread_only).toBeUndefined();
  });

  it("level/type 受枚举约束", () => {
    expect(notificationQuerySchema.safeParse({ level: "high" }).success).toBe(true);
    expect(notificationQuerySchema.safeParse({ level: "urgent" }).success).toBe(false);
    expect(notificationQuerySchema.safeParse({ type: "mention" }).success).toBe(true);
    expect(notificationQuerySchema.safeParse({ type: "everything" }).success).toBe(false);
  });
});
