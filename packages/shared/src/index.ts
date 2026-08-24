/**
 * @doughpie/shared —— 全端契约单一事实源（zod schema/枚举/事件目录/通知矩阵/文案/主题）。
 * 铁律：本包只放契约，禁止放实现逻辑（conventions.md §3.2）。
 * 契约变更流程：先改 PLAN.md/专项文档 → 再改本包 → 再改实现。
 */

export * from "./limits.js";
export * from "./enums.js";
export * from "./errors.js";
export * from "./events.js";
export * from "./notify-matrix.js";
export * from "./copy.js";
export * from "./schemas/common.js";
export * from "./schemas/auth.js";
export * from "./schemas/workspace.js";
export * from "./schemas/list.js";
export * from "./schemas/task.js";
export * from "./schemas/comment.js";
export * from "./schemas/notification.js";
export * from "./theme/tokens.js";

export { default as themesJson } from "./theme/themes.json" with { type: "json" };
