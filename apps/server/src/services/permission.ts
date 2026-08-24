import type { WorkspaceRole } from "@doughpie/shared";

/**
 * 权限矩阵（P0-5，backend.md §7）：workspace 级三角色的纯函数判定。
 * service 层每个方法入口校验（非仅路由层）；viewer 只读，owner 独有管理动作。
 */

export const WORKSPACE_ACTIONS = [
  "workspace.read",
  "workspace.update",
  "member.read",
  "member.role_change",
  "member.remove",
  "invite.create",
  "invite.read",
  "invite.revoke",
  "list.read",
  "list.write",
  "task.read",
  "task.write",
  "subtask.read",
  "subtask.write",
  "comment.read",
  "comment.write",
  "event.read",
] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

/** 只读动作：三角色均可（viewer 的全部能力） */
const READ_ACTIONS: ReadonlySet<WorkspaceAction> = new Set([
  "workspace.read",
  "member.read",
  "list.read",
  "task.read",
  "subtask.read",
  "comment.read",
  "event.read",
]);

/** member 在只读之上追加的业务写 + 邀请创建/查看 */
const MEMBER_ACTIONS: ReadonlySet<WorkspaceAction> = new Set([
  "invite.create",
  "invite.read",
  "list.write",
  "task.write",
  "subtask.write",
  "comment.write",
]);

/** owner 独有：工作区设置 / 成员管理 / 邀请作废 */
const OWNER_ACTIONS: ReadonlySet<WorkspaceAction> = new Set([
  "workspace.update",
  "member.role_change",
  "member.remove",
  "invite.revoke",
]);

/** 纯函数权限判定：role 是否允许 action。未知动作一律拒绝（默认拒绝原则） */
export function can(role: WorkspaceRole, action: WorkspaceAction): boolean {
  if (READ_ACTIONS.has(action)) return true;
  if (role === "viewer") return false;
  if (MEMBER_ACTIONS.has(action)) return true;
  return role === "owner" && OWNER_ACTIONS.has(action);
}
