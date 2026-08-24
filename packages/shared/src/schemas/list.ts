import { z } from "zod";
import { LIST_NAME_MAX } from "../limits.js";

/**
 * 清单契约（PLAN.md P0-3）：CRUD + 颜色 + 手动排序（间隙值）。
 */

/** 清单颜色：自由 hex，渲染时映射到色板；空 = 默认色 */
export const listColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "颜色须为 #RRGGBB");

export const createListBodySchema = z.object({
  name: z.string().trim().min(1).max(LIST_NAME_MAX),
  color: listColorSchema.nullable().optional(),
});
export type CreateListBody = z.infer<typeof createListBodySchema>;

export const updateListBodySchema = z
  .object({
    name: z.string().trim().min(1).max(LIST_NAME_MAX).optional(),
    color: listColorSchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, { message: "至少修改一项" });
export type UpdateListBody = z.infer<typeof updateListBodySchema>;

export const listSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string(),
  color: z.string().nullable(),
  sort_order: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type List = z.infer<typeof listSchema>;

/**
 * 手动排序（看板列内/清单树通用）：给出落点的前后邻居，服务端按间隙值取中位；
 * 间隙耗尽时服务端重排整列。排序冲突接受后写者胜（PLAN.md §4），无乐观锁。
 */
export const moveBodySchema = z
  .object({
    before_id: z.string().uuid().nullable().optional(),
    after_id: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.before_id !== undefined || v.after_id !== undefined, {
    message: "至少给出一个落点参照",
  });
export type MoveBody = z.infer<typeof moveBodySchema>;
