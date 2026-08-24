import type { ErrorCode } from "@doughpie/shared";

/**
 * 领域错误：service 层抛出，错误处理插件统一渲染为扁平 { code, message }（conventions.md §3.2）。
 * code 只能取 shared/errors.ts 冻结的错误码。
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
