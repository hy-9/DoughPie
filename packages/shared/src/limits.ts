/**
 * 字段与配额上限常量（全端共用）。
 * 来源：PLAN.md §8 界面与交互细则、backend.md §3/§5；未规定项见行内注释。
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 10000;
export const SUBTASKS_PER_TASK_MAX = 50;
/** PLAN.md 未规定评论长度，取 5000（够用且防滥用）；如需调整先改 PLAN.md */
export const COMMENT_MAX = 5000;

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 32;
export const DISPLAY_NAME_MAX = 50;
export const WORKSPACE_NAME_MAX = 50;
export const LIST_NAME_MAX = 50;

/** 密码 ≥8 位且含字母+数字（与 UC 规则一致，backend.md §2.2） */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** 排序间隙值：相邻两项 sort_order 间距，插入取中位（backend.md §3） */
export const SORT_GAP = 1000;
/** 列表游标分页每页条数（PLAN.md §8） */
export const PAGE_SIZE = 50;
/** 邀请链接默认 7 天有效（PLAN.md §8） */
export const INVITE_TTL_DAYS = 7;
/** SSO 首登选择页一次性票据有效期（backend.md §2.4） */
export const PENDING_SSO_TTL_MINUTES = 5;
/** 讨论区仅一级回复（PLAN.md §6.1） */
export const COMMENT_PARENT_DEPTH = 1;

export const ATTACHMENT_MAX_MB = 10;
export const ATTACHMENTS_PER_TASK_MAX = 10;
