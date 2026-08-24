import { describe, expect, it } from "vitest";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@doughpie/shared";
import { WORKSPACE_ACTIONS, can, type WorkspaceAction } from "./permission.js";

/**
 * L1 权限矩阵（P0-5，backend.md §7）：三角色 × 全动作 allow/deny 全覆盖。
 * 断言从规格推导：viewer 只读；member = 业务写 + 邀请创建/查看；owner = member 全部 +
 * 工作区设置 / 成员管理 / 邀请作废。
 */

// 规格推导的完整期望矩阵（行=动作，列=owner/member/viewer）
const EXPECTED_MATRIX: Record<WorkspaceAction, Record<WorkspaceRole, boolean>> = {
  "workspace.read": { owner: true, member: true, viewer: true },
  "workspace.update": { owner: true, member: false, viewer: false },
  "member.read": { owner: true, member: true, viewer: true },
  "member.role_change": { owner: true, member: false, viewer: false },
  "member.remove": { owner: true, member: false, viewer: false },
  "invite.create": { owner: true, member: true, viewer: false },
  "invite.read": { owner: true, member: true, viewer: false },
  "invite.revoke": { owner: true, member: false, viewer: false },
  "list.read": { owner: true, member: true, viewer: true },
  "list.write": { owner: true, member: true, viewer: false },
  "task.read": { owner: true, member: true, viewer: true },
  "task.write": { owner: true, member: true, viewer: false },
  "subtask.read": { owner: true, member: true, viewer: true },
  "subtask.write": { owner: true, member: true, viewer: false },
  "comment.read": { owner: true, member: true, viewer: true },
  "comment.write": { owner: true, member: true, viewer: false },
  "event.read": { owner: true, member: true, viewer: true },
};

describe("权限矩阵 can(role, action)（L1，P0-5）", () => {
  it("动作目录与期望矩阵一一对应（防漏定义/漏断言）", () => {
    expect(new Set(WORKSPACE_ACTIONS)).toEqual(new Set(Object.keys(EXPECTED_MATRIX)));
  });

  for (const action of Object.keys(EXPECTED_MATRIX) as WorkspaceAction[]) {
    for (const role of WORKSPACE_ROLES) {
      const expected = EXPECTED_MATRIX[action][role];
      it(`${role} ${expected ? "允许" : "禁止"} ${action}`, () => {
        expect(can(role, action)).toBe(expected);
      });
    }
  }
});
