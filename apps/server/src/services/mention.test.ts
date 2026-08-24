import { describe, expect, it } from "vitest";
import { extractMentionNames } from "./mention.js";

/**
 * L1 @提及候选提取（PLAN.md §5.5/§10：仅 @工作区成员，防骚扰）。
 * 本模块只做正则提取 + 去重保序；「是否本工作区成员」由 service 层校验，
 * 非成员/不存在 → 纯文本不成提及（不产生通知）。
 */

describe("@提及候选提取（L1）", () => {
  it("基本提取：@alice", () => {
    expect(extractMentionNames("你好 @alice 看一下这个任务")).toEqual(["alice"]);
  });

  it("中文用户名：@张三 与 @李四", () => {
    expect(extractMentionNames("@张三 和 @李四 请确认")).toEqual(["张三", "李四"]);
  });

  it("去重且保序：@bob @alice @bob → [bob, alice]", () => {
    expect(extractMentionNames("@bob @alice @bob")).toEqual(["bob", "alice"]);
  });

  it("无提及 → 空数组", () => {
    expect(extractMentionNames("没有提及任何人")).toEqual([]);
  });

  it("标点边界：@alice，@bob。 均可提取", () => {
    expect(extractMentionNames("@alice，@bob。请过目")).toEqual(["alice", "bob"]);
  });

  it("用户名允许字符集：字母/数字/._-/中文", () => {
    expect(extractMentionNames("@a.b_c-d 和 @user_01")).toEqual(["a.b_c-d", "user_01"]);
  });

  it("行首与换行处的 @ 均可提取", () => {
    expect(extractMentionNames("@alice\n@bob")).toEqual(["alice", "bob"]);
  });

  it("@ 后紧跟空格/非法字符 → 不提取", () => {
    expect(extractMentionNames("@ alice")).toEqual([]);
    expect(extractMentionNames("@@")).toEqual([]);
  });

  it("邮箱形态会被正则提取为候选（成员校验在 service 层，非成员按纯文本处理）", () => {
    // 锁定契约正则的行为：a@b.com 提取出 "b.com"，由 service 层判定其非成员而忽略
    expect(extractMentionNames("联系 a@b.com")).toEqual(["b.com"]);
  });
});
