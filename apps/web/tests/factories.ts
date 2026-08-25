import type { Notification, Task, User } from "@doughpie/shared";

/**
 * 测试数据工厂（conventions.md §5.2：factory 模式，禁止共享可变 fixture——
 * 每个工厂函数返回全新对象，调用方传 patch 覆盖差异字段）。
 */

let seq = 0;
/** 递增序号：避免同一测试文件内 id 撞车 */
const next = () => {
  seq += 1;
  return seq;
};

/** 生成合法 uuid v4 形态（契约 uuidSchema 校验用；测试内仅需形态唯一） */
export function fakeUuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export function makeTask(patch: Partial<Task> = {}): Task {
  const n = next();
  return {
    id: fakeUuid(n),
    workspace_id: fakeUuid(10_000),
    list_id: fakeUuid(20_000),
    title: `任务 ${n}`,
    description: null,
    assignee_id: null,
    status: "todo",
    priority: "none",
    start_at: null,
    due_at: null,
    remind_at: null,
    recurrence: null,
    sort_order: n * 1000,
    version: 1,
    subtask_total: 0,
    subtask_done: 0,
    completed_at: null,
    completed_by: null,
    created_by: fakeUuid(30_000),
    created_at: "2026-08-24T10:00:00.000Z",
    updated_at: "2026-08-24T10:00:00.000Z",
    ...patch,
  };
}

export function makeNotification(patch: Partial<Notification> = {}): Notification {
  const n = next();
  return {
    id: fakeUuid(n),
    user_id: fakeUuid(40_000),
    workspace_id: fakeUuid(10_000),
    type: "progress",
    level: "low",
    entity: "task",
    entity_id: fakeUuid(50_000),
    actor_id: null,
    payload: {},
    read_at: null,
    ack_at: null,
    created_at: "2026-08-24T10:00:00.000Z",
    ...patch,
  };
}

export function makeUser(patch: Partial<User> = {}): User {
  const n = next();
  return {
    id: fakeUuid(n),
    username: `user${n}`,
    display_name: `用户${n}`,
    status: "active",
    role: "user",
    has_uc_identity: false,
    has_password: true,
    created_at: "2026-08-24T10:00:00.000Z",
    updated_at: "2026-08-24T10:00:00.000Z",
    ...patch,
  };
}
