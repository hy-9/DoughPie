import { describe, expect, it } from "vitest";
import { fakeUuid, makeNotification } from "../../tests/factories";
import { groupNotifications } from "./notifications";

/**
 * 通知分组聚合（PLAN.md §5.4）：同任务 N 条折叠为一组；
 * 组显未读数 + 组内最高等级；组间按最新一条倒序；无任务归属的各自成组。
 */
describe("通知分组聚合（groupNotifications）", () => {
  const taskA = fakeUuid(100);
  const taskB = fakeUuid(200);

  it("同任务多条折叠为一组，未读数只计未读，组等级取最高", () => {
    const groups = groupNotifications([
      makeNotification({
        id: fakeUuid(1),
        type: "mention",
        level: "high",
        payload: { task_id: taskA, title: "任务A" },
        created_at: "2026-08-24T10:00:00.000Z",
      }),
      makeNotification({
        id: fakeUuid(2),
        type: "progress",
        level: "low",
        payload: { task_id: taskA },
        read_at: "2026-08-24T11:00:00.000Z", // 已读不计入未读数
        created_at: "2026-08-24T11:00:00.000Z",
      }),
      makeNotification({
        id: fakeUuid(3),
        type: "assigned",
        level: "mid",
        payload: { task_id: taskA },
        created_at: "2026-08-24T12:00:00.000Z",
      }),
    ]);

    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.task_id).toBe(taskA);
    expect(g.task_title).toBe("任务A");
    expect(g.items).toHaveLength(3);
    expect(g.unread_count).toBe(2);
    expect(g.top_level).toBe("high");
    // 组内按时间倒序
    expect(g.items[0]?.id).toBe(fakeUuid(3));
  });

  it("不同任务不合并；组间按组内最新一条倒序", () => {
    const groups = groupNotifications([
      makeNotification({
        id: fakeUuid(1),
        payload: { task_id: taskA, title: "任务A" },
        created_at: "2026-08-24T10:00:00.000Z",
      }),
      makeNotification({
        id: fakeUuid(2),
        payload: { task_id: taskB, title: "任务B" },
        created_at: "2026-08-24T12:00:00.000Z",
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.task_id).toBe(taskB);
    expect(groups[1]?.task_id).toBe(taskA);
  });

  it("无任务归属的通知（如系统类）各自成组，不互相折叠", () => {
    const groups = groupNotifications([
      makeNotification({ id: fakeUuid(1), type: "system", entity: "workspace", payload: {} }),
      makeNotification({ id: fakeUuid(2), type: "system", entity: "workspace", payload: {} }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.task_id === null)).toBe(true);
  });

  it("entity=task 且无 payload.task_id 时以 entity_id 兜底分组", () => {
    const groups = groupNotifications([
      makeNotification({ id: fakeUuid(1), entity: "task", entity_id: taskA, payload: {} }),
      makeNotification({ id: fakeUuid(2), entity: "task", entity_id: taskA, payload: {} }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.task_id).toBe(taskA);
  });
});
