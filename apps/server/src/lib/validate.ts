import type { z } from "zod";
import { COPY, ifMatchHeaderSchema } from "@doughpie/shared";
import { ApiError } from "./api-error.js";

/** zod 校验请求体：失败统一 400 VALIDATION_FAILED（文案走 shared COPY） */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
  }
  return parsed.data;
}

/**
 * 解析 If-Match 乐观锁头（PLAN.md §4：任务类写操作必带）。
 * 缺失/非整数 → 400 VALIDATION_FAILED。
 */
export function parseIfMatch(header: string | undefined): number {
  const parsed = ifMatchHeaderSchema.safeParse(header);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
  }
  return parsed.data;
}
