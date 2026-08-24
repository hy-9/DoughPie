import { and, asc, eq, gt, type SQL } from "drizzle-orm";
import {
  COPY,
  type CursorPage,
  type CursorQuery,
  type EventEnvelope,
  type EventEntity,
  type EventType,
} from "@doughpie/shared";
import type { Db, Tx } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { events, type EventRow } from "../models/schema.js";

/**
 * events 基础设施（PLAN.md §4：一石四鸟——断线补齐/动态流/审计/通知数据源）。
 * 铁律：所有业务写必须在同一事务内调用 writeEvent（AGENTS.md 关键设计约束）。
 * D 阶段 socket 广播复用本模块的数据源（游标 = events.id，bigserial 全局单调）。
 */

export interface WriteEventInput {
  workspaceId: string;
  actorId: string;
  type: EventType;
  entity: EventEntity;
  entityId: string;
  /** 变更载荷：携带消费方失效缓存所需字段（如 task 事件带 list_id/title/status/version） */
  payload?: Record<string, unknown>;
}

/** 同事务写事件。只在业务写的事务内调用，禁止脱离事务单写；id 由 bigserial 自增生成 */
export async function writeEvent(tx: Tx, input: WriteEventInput): Promise<void> {
  await tx.insert(events).values({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    type: input.type,
    entity: input.entity,
    entityId: input.entityId,
    payload: input.payload ?? {},
  });
}

/** EventRow → 对外事件信封（id 序列化为 string，防 int8 精度丢失） */
export function toEventDto(row: EventRow): EventEnvelope {
  return {
    id: row.id.toString(),
    workspace_id: row.workspaceId,
    actor_id: row.actorId,
    type: row.type,
    entity: row.entity,
    entity_id: row.entityId,
    payload: row.payload,
    created_at: row.createdAt.toISOString(),
  };
}

export interface EventServiceDeps {
  db: Db;
}

export type EventService = ReturnType<typeof createEventService>;

export function createEventService(deps: EventServiceDeps) {
  const { db } = deps;

  return {
    /**
     * 游标补齐：GET /workspaces/:id/events?cursor=&limit=
     * cursor = 事件 id（string）；返回 id > cursor 的事件，按 id 升序。
     * 权限由调用方校验（event.read，三角色均可）。
     */
    async listEvents(workspaceId: string, query: CursorQuery): Promise<CursorPage<EventEnvelope>> {
      let cursorId: bigint | null = null;
      if (query.cursor !== undefined) {
        if (!/^\d+$/.test(query.cursor)) {
          throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
        }
        cursorId = BigInt(query.cursor);
      }
      const conditions: SQL[] = [eq(events.workspaceId, workspaceId)];
      if (cursorId !== null) conditions.push(gt(events.id, cursorId));
      const rows = await db
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(asc(events.id))
        .limit(query.limit + 1);
      const items = rows.slice(0, query.limit);
      const last = items[items.length - 1];
      return {
        items: items.map(toEventDto),
        next_cursor: rows.length > query.limit && last ? last.id.toString() : null,
      };
    },
  };
}
