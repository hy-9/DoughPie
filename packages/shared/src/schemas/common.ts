import { z } from "zod";
import { PAGE_SIZE } from "../limits.js";

/** 通用基础 schema：ID、时间、分页、错误、乐观锁头 */

export const uuidSchema = z.string().uuid();

/** ISO 8601 时间串；存储一律 UTC，展示层转本地时区（PLAN.md §8） */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** 游标分页查询（tasks/events/notifications；列表 50 条 + 无限滚动） */
export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** 游标分页响应信封 */
export interface CursorPage<T> {
  items: T[];
  /** 下一页游标；null = 没有更多了 */
  next_cursor: string | null;
} /** 扁平错误结构（与 UC 风格一致，conventions.md §3.2） */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

/** 乐观锁：写操作必须携带 If-Match: <version>（PLAN.md §4），不符返回 409 */
export const ifMatchHeaderSchema = z.coerce.number().int().nonnegative();
