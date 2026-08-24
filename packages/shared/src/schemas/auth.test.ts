import { describe, expect, it } from "vitest";
import { passwordSchema, registerBodySchema, usernameSchema } from "./auth.js";

describe("认证契约", () => {
  it("密码至少 8 位且含字母+数字", () => {
    expect(passwordSchema.safeParse("abc12345").success).toBe(true);
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false); // 纯字母
    expect(passwordSchema.safeParse("12345678").success).toBe(false); // 纯数字
    expect(passwordSchema.safeParse("abc1234").success).toBe(false); // 不足 8 位
  });

  it("用户名 ≥2 字符，支持中文与 ._-", () => {
    expect(usernameSchema.safeParse("豆腐").success).toBe(true);
    expect(usernameSchema.safeParse("dou_pai-pai.2").success).toBe(true);
    expect(usernameSchema.safeParse("a").success).toBe(false);
    expect(usernameSchema.safeParse("含 空格").success).toBe(false);
  });

  it("注册体：display_name 可选，缺省不报错", () => {
    expect(registerBodySchema.safeParse({ username: "doufu", password: "abc12345" }).success).toBe(
      true,
    );
  });
});
