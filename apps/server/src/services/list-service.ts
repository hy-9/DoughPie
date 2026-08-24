import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  COPY,
  type CreateListBody,
  type List,
  type MoveBody,
  type UpdateListBody,
} from "@doughpie/shared";
import type { Db, Tx } from "../db.js";
import { ApiError } from "../lib/api-error.js";
import { lists, tasks, type ListRow } from "../models/schema.js";
import { writeEvent } from "./event-service.js";
import { gapInsertOrder, resequencedOrders } from "./sort-order.js";
import { requireCan } from "./workspace-guard.js";

/**
 * 清单业务流（P0-3）：CRUD + 颜色 + 手动排序。
 * 排序用间隙算法（SORT_GAP=1000），后写者胜、无乐观锁（PLAN.md §4）。
 * 删除清单：其下任务一并软删除（同事务 + 事件）。
 */

export interface ListServiceDeps {
  db: Db;
}

export type ListService = ReturnType<typeof createListService>;

function toListDto(row: ListRow): List {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    color: row.color,
    sort_order: row.sortOrder,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * 计算移动后的 sort_order；间隙耗尽时同事务整列重排后重算。
 * @param siblings 同列其余项（已排除被移动项），按 sort_order 升序
 */
async function placeWithGap<T extends { id: string; sortOrder: number }>(
  tx: Tx,
  siblings: T[],
  body: MoveBody,
  /** 整列重排落库回调（参数含被移动项之外的全部兄弟，按新顺序值） */
  resequence: (rows: T[], freshOrders: number[]) => Promise<void>,
): Promise<number | null> {
  // 落点邻居：after_id → 前邻居；before_id → 后邻居（引用不存在 → 400）
  let prev: T | null = null;
  let next: T | null = null;
  if (body.after_id != null) {
    prev = siblings.find((s) => s.id === body.after_id) ?? null;
    if (prev === null) throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
  }
  if (body.before_id != null) {
    next = siblings.find((s) => s.id === body.before_id) ?? null;
    if (next === null) throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
  }

  let order = gapInsertOrder(prev?.sortOrder ?? null, next?.sortOrder ?? null);
  if (order !== null) return order;

  // 间隙耗尽：整列重排回 1000 的倍数（保持相对顺序），再重算落点
  const fresh = resequencedOrders(siblings.length);
  await resequence(siblings, fresh);
  const remapped = siblings.map((s, i) => ({ id: s.id, sortOrder: fresh[i] ?? 0 }));
  // 固定到 const 以保留 null 收窄（let 在闭包内不保留收窄）
  const prevFixed = prev;
  const nextFixed = next;
  const prev2 = prevFixed === null ? null : (remapped.find((s) => s.id === prevFixed.id) ?? null);
  const next2 = nextFixed === null ? null : (remapped.find((s) => s.id === nextFixed.id) ?? null);
  order = gapInsertOrder(prev2?.sortOrder ?? null, next2?.sortOrder ?? null);
  // 重排后必有足够间隙（最坏头部 1000/2=500）；null 属逻辑错误
  if (order === null) throw new ApiError(500, "INTERNAL", COPY.common.internal);
  return order;
}

export function createListService(deps: ListServiceDeps) {
  const { db } = deps;

  /** 载入清单；不存在 → 404 */
  async function loadList(listId: string): Promise<ListRow> {
    const row = await db.query.lists.findFirst({ where: eq(lists.id, listId) });
    if (!row) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
    return row;
  }

  return {
    /** 清单列表（按 sort_order 升序） */
    async listLists(userId: string, workspaceId: string): Promise<List[]> {
      await requireCan(db, workspaceId, userId, "list.read");
      const rows = await db
        .select()
        .from(lists)
        .where(eq(lists.workspaceId, workspaceId))
        .orderBy(asc(lists.sortOrder));
      return rows.map(toListDto);
    },

    /** 新建清单：排尾（max+1000，空列取 1000） */
    async createList(userId: string, workspaceId: string, body: CreateListBody): Promise<List> {
      await requireCan(db, workspaceId, userId, "list.write");
      return db.transaction(async (tx) => {
        const siblings = await tx
          .select({ sortOrder: lists.sortOrder })
          .from(lists)
          .where(eq(lists.workspaceId, workspaceId))
          .orderBy(asc(lists.sortOrder));
        const tail = siblings[siblings.length - 1]?.sortOrder ?? null;
        const sortOrder = gapInsertOrder(tail, null);
        if (sortOrder === null) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        const [row] = await tx
          .insert(lists)
          .values({
            id: uuidv7(),
            workspaceId,
            name: body.name,
            color: body.color ?? null,
            sortOrder,
          })
          .returning();
        if (!row) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        await writeEvent(tx, {
          workspaceId,
          actorId: userId,
          type: "list.created",
          entity: "list",
          entityId: row.id,
          payload: { name: row.name, color: row.color, sort_order: row.sortOrder },
        });
        return toListDto(row);
      });
    },

    /** 重命名/改色 */
    async updateList(userId: string, listId: string, body: UpdateListBody): Promise<List> {
      const list = await loadList(listId);
      await requireCan(db, list.workspaceId, userId, "list.write");
      const now = new Date();
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(lists)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            updatedAt: now,
          })
          .where(eq(lists.id, listId))
          .returning();
        if (rows.length === 0) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        await writeEvent(tx, {
          workspaceId: list.workspaceId,
          actorId: userId,
          type: "list.updated",
          entity: "list",
          entityId: listId,
          payload: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
          },
        });
        return rows;
      });
      if (!updated) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
      return toListDto(updated);
    },

    /** 删除清单：其下任务一并软删除（同事务；list.deleted + 每任务 task.deleted 事件） */
    async deleteList(userId: string, listId: string): Promise<void> {
      const list = await loadList(listId);
      await requireCan(db, list.workspaceId, userId, "list.write");
      await db.transaction(async (tx) => {
        const affected = await tx
          .update(tasks)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(tasks.listId, listId), isNull(tasks.deletedAt)))
          .returning({ id: tasks.id, title: tasks.title });
        for (const t of affected) {
          // 逐任务补 task.deleted，消费方无需感知级联细节即可失效缓存
          // oxlint-disable-next-line no-await-in-loop -- 事务内串行写是有意设计：事件顺序与提交一致
          await writeEvent(tx, {
            workspaceId: list.workspaceId,
            actorId: userId,
            type: "task.deleted",
            entity: "task",
            entityId: t.id,
            payload: { list_id: listId, title: t.title, via: "list.deleted" },
          });
        }
        await tx.delete(lists).where(eq(lists.id, listId));
        await writeEvent(tx, {
          workspaceId: list.workspaceId,
          actorId: userId,
          type: "list.deleted",
          entity: "list",
          entityId: listId,
          payload: { name: list.name, task_ids: affected.map((t) => t.id) },
        });
      });
    },

    /** 手动排序（后写者胜，无乐观锁）：before_id/after_id 给定落点 */
    async moveList(userId: string, listId: string, body: MoveBody): Promise<List> {
      const list = await loadList(listId);
      await requireCan(db, list.workspaceId, userId, "list.write");
      if (body.before_id === listId || body.after_id === listId) {
        throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
      }
      return db.transaction(async (tx) => {
        const siblings = await tx
          .select({ id: lists.id, sortOrder: lists.sortOrder })
          .from(lists)
          .where(and(eq(lists.workspaceId, list.workspaceId), ne(lists.id, listId)))
          .orderBy(asc(lists.sortOrder));
        const sortOrder = await placeWithGap(tx, siblings, body, async (rows, fresh) => {
          for (const [i, row] of rows.entries()) {
            // oxlint-disable-next-line no-await-in-loop -- 事务内串行写是有意设计：重排必须按序落库
            await tx
              .update(lists)
              .set({ sortOrder: fresh[i] ?? 0 })
              .where(eq(lists.id, row.id));
          }
        });
        if (sortOrder === null) throw new ApiError(500, "INTERNAL", COPY.common.internal);
        const [updated] = await tx
          .update(lists)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(lists.id, listId))
          .returning();
        if (!updated) throw new ApiError(404, "NOT_FOUND", COPY.common.notFound);
        await writeEvent(tx, {
          workspaceId: list.workspaceId,
          actorId: userId,
          type: "list.reordered",
          entity: "list",
          entityId: listId,
          payload: { sort_order: sortOrder },
        });
        return toListDto(updated);
      });
    },
  };
}
