import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { events } from "../models/schema.js";
import { createSubtaskService, type SubtaskService } from "./subtask-service.js";
import { createTaskService } from "./task-service.js";
import {
  insertList,
  insertMembership,
  insertTask,
  insertUser,
  insertWorkspace,
} from "../../tests/factories.js";
import { createTestDb, truncateAll } from "../../tests/helpers.js";

/** L2 子任务业务流（P0-9）：仅标题+完成态；每任务 ≤50；按创建序排 */

async function expectApiError(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ statusCode: status, code });
}

describe("子任务服务（L2）", () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let svc: SubtaskService;

  beforeAll(async () => {
    ({ db, close: closeDb } = createTestDb());
    svc = createSubtaskService({ db });
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function setup() {
    const owner = await insertUser(db);
    const ws = await insertWorkspace(db, owner);
    const list = await insertList(db, ws.id);
    const task = await insertTask(db, { workspaceId: ws.id, listId: list.id, createdBy: owner.id });
    return { owner, ws, list, task };
  }

  it("CRUD：建（排尾 1000/2000）→ 勾选/改名 → 删除；各写事件", async () => {
    const { owner, ws, task } = await setup();
    const s1 = await svc.createSubtask(owner.id, task.id, { title: "步骤一" });
    const s2 = await svc.createSubtask(owner.id, task.id, { title: "步骤二" });
    expect([s1.sort_order, s2.sort_order]).toEqual([1000, 2000]);
    expect(s1.done).toBe(false);

    const checked = await svc.updateSubtask(owner.id, s1.id, { done: true });
    expect(checked.done).toBe(true);
    const renamed = await svc.updateSubtask(owner.id, s2.id, { title: "步骤二改" });
    expect(renamed.title).toBe("步骤二改");

    const list = await svc.listSubtasks(owner.id, task.id);
    expect(list.map((s) => s.title)).toEqual(["步骤一", "步骤二改"]);

    await svc.deleteSubtask(owner.id, s1.id);
    expect((await svc.listSubtasks(owner.id, task.id)).map((s) => s.id)).toEqual([s2.id]);

    const evRows = await db.select().from(events).where(eq(events.workspaceId, ws.id));
    const types = evRows.map((e) => e.type);
    expect(types.filter((t) => t === "subtask.created")).toHaveLength(2);
    expect(types.filter((t) => t === "subtask.updated")).toHaveLength(2);
    expect(types.filter((t) => t === "subtask.deleted")).toHaveLength(1);
    const deletedEv = evRows.find((e) => e.type === "subtask.deleted");
    expect(deletedEv?.payload).toMatchObject({ task_id: task.id, title: "步骤一" });
  });

  it("每任务 ≤50 个：第 51 个 → 409 SUBTASK_LIMIT", async () => {
    const { owner, task } = await setup();
    for (let i = 0; i < 50; i++) {
      // oxlint-disable-next-line no-await-in-loop -- 必须串行：每次创建都基于当前排尾值计算间隙
      await svc.createSubtask(owner.id, task.id, { title: `子_${i}` });
    }
    await expectApiError(
      svc.createSubtask(owner.id, task.id, { title: "超了" }),
      409,
      "SUBTASK_LIMIT",
    );
    // 删掉一个后可以继续建
    const all = await svc.listSubtasks(owner.id, task.id);
    await svc.deleteSubtask(owner.id, all[0]!.id);
    const again = await svc.createSubtask(owner.id, task.id, { title: "补位" });
    expect(again.title).toBe("补位");
  });

  it("权限与软删：viewer 不可写；任务软删后子任务操作 → 404/403", async () => {
    const { owner, ws, task } = await setup();
    const viewer = await insertUser(db);
    await insertMembership(db, ws.id, viewer.id, "viewer");
    const s1 = await svc.createSubtask(owner.id, task.id, { title: "只读看" });

    // viewer 可读不可写
    expect(await svc.listSubtasks(viewer.id, task.id)).toHaveLength(1);
    await expectApiError(svc.createSubtask(viewer.id, task.id, { title: "x" }), 403, "FORBIDDEN");
    await expectApiError(svc.updateSubtask(viewer.id, s1.id, { done: true }), 403, "FORBIDDEN");

    // 任务软删后 404
    await createTaskService({ db }).deleteTask(owner.id, task.id);
    await expectApiError(svc.listSubtasks(owner.id, task.id), 404, "NOT_FOUND");
    await expectApiError(svc.updateSubtask(owner.id, s1.id, { done: true }), 404, "NOT_FOUND");
  });
});
