import type { z } from "zod";
import { COPY } from "@doughpie/shared";
import { ApiError } from "./api-error.js";

/** zod 校验请求体：失败统一 400 VALIDATION_FAILED（文案走 shared COPY） */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_FAILED", COPY.common.validationFailed);
  }
  return parsed.data;
}
