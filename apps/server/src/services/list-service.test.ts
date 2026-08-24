import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db.js";
import { events, lists, tasks } from "../models/schema.js";
import { createListService, type ListService } from "./list-service.js";
import {
  insertList,
  insertMembership,
  insertTask,
  insertUser,
  insertWorkspace,
} from "../../tests/factories.js";
import { createTestDb, truncateAll } from "../../tests/helpers.js";

/**
 * L2 清单业务流（P0-3）：CRUD + 颜色 + 手动排序（间隙算法）+ 删除级联软删任务。
 * 排序冲突后写者胜（无乐观锁，PLAN.md §4）。
 */

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ statusCode: status, code });
}

describe("清单服务（L2）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let svc: ListService;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
    svc = createListService({ db });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("新建清单：排尾 1000/2000/3000；带颜色；写 list.created 事件", async () => {
    const owner = await insertUser(db);
    const ws = await insertWorkspace(db, owner);

    const l1 = await svc.createList(owner.id, ws.id, { name: "待办", color: "#3B82F6" });
    const l2 = await svc.createList(owner.id, ws.id, { name: "进行中" });
    const l3 = await svc.createList(owner.id, ws.id, { name: "完成" });
    expect([l1.sort_order, l2.sort_order, l3.sort_order]).toEqual([1000, 2000, 3000]);
    expect(l1.color).toBe("#3B82F6");
    expect(l2.color).toBeNull();

    const all = await svc.listLists(owner.id, ws.id);
    expect(all.map((l) => l.name)).toEqual(["待办", "进行中", "完成"]);

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "list.created")));
    expect(evRows).toHaveLength(3);
    expect(evRows[0]?.payload).toMatchObject({ name: "待办", color: "#3B82F6", sort_order: 1000 });
  });

  it("更新清单：改名/改色/清空颜色，写 list.updated 事件", async () => {
    const owner = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    const list = await insertList(db, ws.id, { name: "旧名", color: "#3B82F6" });

    const updated = await svc.updateList(owner.id, list.id, { name: "新名", color: null });
    expect(updated.name).toBe("新名");
    expect(updated.color).toBeNull();

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "list.updated")));
    expect(evRows).toHaveLength(1);
    expect(evRows[0]?.payload).toEqual({ name: "新名", color: null });

    await expectApiError(
      svc.updateList(owner.id, crypto.randomUUID(), { name: "x" }),
      404,
      "NOT_FOUND",
    );
  });

  it("删除清单：其下任务一并软删除（同事务），list.deleted + 逐任务 task.deleted 事件", async () => {
    const owner = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    const list = await insertList(db, ws.id, { name: "要删的" });
    const other = await insertList(db, ws.id, { name: "保留的" });
    const t1 = await insertTask(db, { workspaceId: ws.id, listId: list.id, createdBy: owner.id });
    const t2 = await insertTask(db, { workspaceId: ws.id, listId: list.id, createdBy: owner.id });
    const keep = await insertTask(db, {
      workspaceId: ws.id,
      listId: other.id,
      createdBy: owner.id,
    });

    await svc.deleteList(owner.id, list.id);

    // 清单硬删；任务软删（deleted_at 非空）；其他清单的任务不动
    expect(await db.query.lists.findFirst({ where: eq(lists.id, list.id) })).toBeUndefined();
    const softDeleted = await Promise.all(
      [t1.id, t2.id].map((tid) => db.query.tasks.findFirst({ where: eq(tasks.id, tid) })),
    );
    for (const row of softDeleted) {
      expect(row?.deletedAt).not.toBeNull();
    }
    const keepRow = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, keep.id), isNull(tasks.deletedAt)),
    });
    expect(keepRow).toBeDefined();

    const evRows = await db.select().from(events).where(eq(events.workspaceId, ws.id));
    const types = evRows.map((e) => e.type);
    expect(types.filter((t) => t === "list.deleted")).toHaveLength(1);
    expect(types.filter((t) => t === "task.deleted")).toHaveLength(2);
    const listDeleted = evRows.find((e) => e.type === "list.deleted");
    expect(listDeleted?.payload).toMatchObject({ name: "要删的" });
    expect((listDeleted?.payload["task_ids"] as string[]) ?? []).toHaveLength(2);
  });

  it("手动排序：插入中间取中位（1000,3000 → 2000）", async () => {
    const owner = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    const l1 = await insertList(db, ws.id, { sortOrder: 1000 });
    const l2 = await insertList(db, ws.id, { sortOrder: 2000 });
    const l3 = await insertList(db, ws.id, { sortOrder: 3000 });

    // 把 l2 移到 l1 与 l3 之间（after l1, before l3）
    const moved = await svc.moveList(owner.id, l2.id, { after_id: l1.id, before_id: l3.id });
    expect(moved.sort_order).toBe(2000);

    // 把 l3 移到最前（before l1）：1000-1000 <1 → 500
    const head = await svc.moveList(owner.id, l3.id, { before_id: l1.id });
    expect(head.sort_order).toBe(500);

    const all = await svc.listLists(owner.id, ws.id);
    expect(all.map((l) => l.id)).toEqual([l3.id, l1.id, l2.id]);

    const evRows = await db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, ws.id), eq(events.type, "list.reordered")));
    expect(evRows).toHaveLength(2);
  });

  it("间隙耗尽触发整列重排：保持相对顺序，落点成功", async () => {
    const owner = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    // 构造已耗尽的间隙：1000 与 1000.5（间隙 <1）
    const l1 = await insertList(db, ws.id, { sortOrder: 1000 });
    const l2 = await insertList(db, ws.id, { sortOrder: 1000.5 });
    const l3 = await insertList(db, ws.id, { sortOrder: 2000 });

    // 把 l3 移到 l1 与 l2 之间：间隙 0.5 <1 → 整列重排为 1000/2000/3000（l1,l2 原位），l3 落 1500
    const moved = await svc.moveList(owner.id, l3.id, { after_id: l1.id, before_id: l2.id });
    expect(moved.sort_order).toBe(1500);

    const all = await svc.listLists(owner.id, ws.id);
    expect(all.map((l) => l.id)).toEqual([l1.id, l3.id, l2.id]);
    expect(all.map((l) => l.sort_order)).toEqual([1000, 1500, 2000]);
  });

  it("排序落点校验：引用不存在/自身 → 400；viewer 写 → 403；非成员读 → 403", async () => {
    const owner = await insertUser(db);
    const viewer = await insertUser(db);
    const outsider = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    await insertMembership(db, ws.id, viewer.id, "viewer");
    const l1 = await insertList(db, ws.id);

    await expectApiError(
      svc.moveList(owner.id, l1.id, { after_id: crypto.randomUUID() }),
      400,
      "VALIDATION_FAILED",
    );
    await expectApiError(
      svc.moveList(owner.id, l1.id, { after_id: l1.id }),
      400,
      "VALIDATION_FAILED",
    );
    await expectApiError(svc.createList(viewer.id, ws.id, { name: "x" }), 403, "FORBIDDEN");
    await expectApiError(svc.deleteList(viewer.id, l1.id), 403, "FORBIDDEN");
    await expectApiError(svc.listLists(outsider.id, ws.id), 403, "FORBIDDEN");
  });
});
