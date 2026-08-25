import type { Priority, TaskStatus, WorkspaceRole } from "@doughpie/shared";

/** 业务枚举 → 中文展示文案（组件层共用，避免散落硬编码） */
export const TASK_STATUS_TEXT: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  review: "待验收",
  done: "已完成",
};

export const PRIORITY_TEXT: Record<Priority, string> = {
  high: "高",
  mid: "中",
  low: "低",
  none: "无",
};

export const WORKSPACE_ROLE_TEXT: Record<WorkspaceRole, string> = {
  owner: "所有者",
  member: "成员",
  viewer: "观察者",
};
