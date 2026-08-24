import { describe, expect, it } from "vitest";
import { LoginGuard, loginGuardKey } from "./login-guard.js";

/**
 * L1 防爆破计数器（backend.md §2.3：内存计数，10 次锁 15 分钟，单进程假设已记录）。
 * 时钟注入，测试中手动拨时间。
 */
function setup(overrides?: { maxFailures?: number; lockMinutes?: number }) {
  let current = 1_000_000;
  const guard = new LoginGuard({
    maxFailures: overrides?.maxFailures ?? 10,
    lockMinutes: overrides?.lockMinutes ?? 15,
    now: () => current,
  });
  return {
    guard,
    key: loginGuardKey("alice", "1.2.3.4"),
    /** 拨快时钟（毫秒） */
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("登录防爆破计数器（L1）", () => {
  it("连续失败未达阈值（9 次）不锁定", () => {
    const { guard, key } = setup();
    for (let i = 0; i < 9; i++) guard.recordFailure(key);
    expect(guard.isLocked(key)).toBe(false);
  });

  it("第 10 次失败后立即锁定", () => {
    const { guard, key } = setup();
    for (let i = 0; i < 9; i++) guard.recordFailure(key);
    const result = guard.recordFailure(key); // 第 10 次
    expect(result.locked).toBe(true);
    expect(guard.isLocked(key)).toBe(true);
  });

  it("锁定期间能给出剩余秒数", () => {
    const { guard, key, advance } = setup({ lockMinutes: 15 });
    for (let i = 0; i < 10; i++) guard.recordFailure(key);
    expect(guard.lockedSecondsRemaining(key)).toBe(15 * 60);
    advance(61_000);
    expect(guard.lockedSecondsRemaining(key)).toBe(15 * 60 - 61);
  });

  it("锁定期间校验成功也算失败：recordSuccess 不解锁", () => {
    const { guard, key } = setup();
    for (let i = 0; i < 10; i++) guard.recordFailure(key);
    guard.recordSuccess(key);
    expect(guard.isLocked(key)).toBe(true);
  });

  it("锁定到期后自动解锁", () => {
    const { guard, key, advance } = setup({ lockMinutes: 15 });
    for (let i = 0; i < 10; i++) guard.recordFailure(key);
    advance(15 * 60 * 1000 + 1);
    expect(guard.isLocked(key)).toBe(false);
  });

  it("解锁后重新计数：再次失败从第 1 次算起", () => {
    const { guard, key, advance } = setup({ lockMinutes: 15 });
    for (let i = 0; i < 10; i++) guard.recordFailure(key);
    advance(15 * 60 * 1000 + 1);
    for (let i = 0; i < 9; i++) guard.recordFailure(key);
    expect(guard.isLocked(key)).toBe(false);
    guard.recordFailure(key); // 新一轮第 10 次
    expect(guard.isLocked(key)).toBe(true);
  });

  it("登录成功清零：失败 9 次后成功，再失败 9 次仍不锁定", () => {
    const { guard, key } = setup();
    for (let i = 0; i < 9; i++) guard.recordFailure(key);
    guard.recordSuccess(key);
    for (let i = 0; i < 9; i++) guard.recordFailure(key);
    expect(guard.isLocked(key)).toBe(false);
  });

  it("username+ip 维度隔离：同人不同 IP 互不影响", () => {
    const { guard } = setup();
    const keyA = loginGuardKey("alice", "1.2.3.4");
    const keyB = loginGuardKey("alice", "5.6.7.8");
    for (let i = 0; i < 10; i++) guard.recordFailure(keyA);
    expect(guard.isLocked(keyA)).toBe(true);
    expect(guard.isLocked(keyB)).toBe(false);
  });
});
