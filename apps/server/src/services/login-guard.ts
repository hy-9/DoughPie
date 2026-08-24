/**
 * 登录防爆破计数器（L1 纯逻辑，backend.md §2.3/§8）。
 * 内存 Map 实现：单进程部署假设已记录为设计约束，进程重启计数清零（可接受）。
 * 时钟注入（now）便于测试拨时间。
 */

export interface LoginGuardOptions {
  /** 连续失败阈值（env LOGIN_MAX_FAILURES，默认 10） */
  maxFailures: number;
  /** 锁定时长（env LOGIN_LOCK_MINUTES，默认 15 分钟） */
  lockMinutes: number;
  now?: () => number;
}

interface Entry {
  /** 当前连续失败次数（锁定后保持，不再累加语义外的用途） */
  failures: number;
  /** 锁定截止时刻（ms 时间戳）；null = 未锁定 */
  lockedUntil: number | null;
}

/** 计数维度：username + ip（backend.md §2.3） */
export function loginGuardKey(username: string, ip: string): string {
  return `${username}@${ip}`;
}

export class LoginGuard {
  private readonly entries = new Map<string, Entry>();
  private readonly maxFailures: number;
  private readonly lockMs: number;
  private readonly now: () => number;

  constructor(options: LoginGuardOptions) {
    this.maxFailures = options.maxFailures;
    this.lockMs = options.lockMinutes * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  isLocked(key: string): boolean {
    return this.lockedSecondsRemaining(key) > 0;
  }

  /** 剩余锁定秒数；未锁定或锁定已到期（顺带惰性清理）返回 0 */
  lockedSecondsRemaining(key: string): number {
    const entry = this.entries.get(key);
    if (!entry || entry.lockedUntil === null) return 0;
    const remaining = entry.lockedUntil - this.now();
    if (remaining <= 0) {
      // 到期自动解锁：惰性删除，下一轮失败重新计数
      this.entries.delete(key);
      return 0;
    }
    return Math.ceil(remaining / 1000);
  }

  /** 记录一次失败；达到阈值进入锁定。返回本次失败后是否处于锁定态 */
  recordFailure(key: string): { locked: boolean } {
    if (this.isLocked(key)) return { locked: true };
    const entry = this.entries.get(key) ?? { failures: 0, lockedUntil: null };
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      entry.lockedUntil = this.now() + this.lockMs;
    }
    this.entries.set(key, entry);
    return { locked: entry.lockedUntil !== null };
  }

  /** 记录一次成功：未锁定时清零；锁定期间的成功视为失败（不解锁，防锁定被探测绕过） */
  recordSuccess(key: string): void {
    if (this.isLocked(key)) return;
    this.entries.delete(key);
  }
}
