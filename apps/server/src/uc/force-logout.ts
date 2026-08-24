import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { userIdentities } from "../models/schema.js";
import type { UcClient } from "./uc-client.js";

/**
 * UC 强退传播（backend.md §2.5）。
 * 注意：UC 的 GET /auth/force-logout-ts 是**按用户**查询（user_id query，以 UC 代码为准），
 * 因此缓存按本地 userId 维度记录强退水位线；refresh 时签发时间早于水位线即吊销。
 * 60s 内存缓存轮询，单进程假设；UC_ENABLED=false 时完全不启动。
 */

export interface ForceLogoutCache {
  get(userId: string): Date | null;
  /** 整体替换（每轮轮询重建，避免解绑用户残留旧水位线） */
  replaceAll(entries: Map<string, Date | null>): void;
}

export function createForceLogoutCache(): ForceLogoutCache {
  let current = new Map<string, Date | null>();
  return {
    get: (userId) => current.get(userId) ?? null,
    replaceAll: (entries) => {
      current = entries;
    },
  };
}

export interface ForceLogoutPollerDeps {
  db: Db;
  ucClient: UcClient;
  cache: ForceLogoutCache;
  /** 轮询间隔（毫秒），默认 60s */
  intervalMs?: number;
  log: { warn: (obj: unknown, msg: string) => void };
}

export interface ForceLogoutPoller {
  /** 立即执行一轮（测试用，也供启动时预热） */
  tick(): Promise<void>;
  stop(): void;
}

export function startForceLogoutPoller(deps: ForceLogoutPollerDeps): ForceLogoutPoller {
  const { db, ucClient, cache, log } = deps;

  async function tick(): Promise<void> {
    const identities = await db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.provider, "uc"));
    const next = new Map<string, Date | null>();
    for (const identity of identities) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 串行查询是有意设计：避免对 UC 瞬时并发突发，20 人规模无性能压力
        next.set(identity.userId, await ucClient.getForceLogoutBefore(identity.providerUserId));
      } catch (err) {
        // 单用户失败不影响整轮；保留旧缓存（不清空，避免 UC 抖动放大为误判）
        log.warn({ err, userId: identity.userId }, "UC 强退水位线查询失败，沿用旧缓存");
        next.set(identity.userId, cache.get(identity.userId));
      }
    }
    cache.replaceAll(next);
  }

  const timer = setInterval(() => {
    tick().catch((err) => log.warn({ err }, "UC 强退轮询失败"));
  }, deps.intervalMs ?? 60_000);
  // 不阻塞进程退出（测试/停机）
  timer.unref();

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}
