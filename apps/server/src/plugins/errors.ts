import { COPY } from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ApiError } from "../lib/api-error.js";

/**
 * 统一错误处理（conventions.md §3.2）：一律扁平 { code, message }。
 * ApiError 原样输出；zod 校验失败 → 400 VALIDATION_FAILED；其余 5xx 记日志后统一 INTERNAL，
 * 内部错误细节不外泄。
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply
        .status(400)
        .send({ code: "VALIDATION_FAILED", message: COPY.common.validationFailed });
    }
    // Fastify 自身错误（如 JSON 解析失败）带 statusCode
    const statusCodeValue = (err as { statusCode?: unknown }).statusCode;
    const statusCode = typeof statusCodeValue === "number" ? statusCodeValue : 500;
    if (statusCode === 400) {
      return reply
        .status(400)
        .send({ code: "VALIDATION_FAILED", message: COPY.common.validationFailed });
    }
    if (statusCode >= 500) {
      req.log.error(err, "未处理的服务器错误");
      return reply.status(500).send({ code: "INTERNAL", message: COPY.common.internal });
    }
    return reply.status(statusCode).send({ code: "INTERNAL", message: COPY.common.internal });
  });

  // 未匹配路由同样输出扁平结构（前端凭 SSO start 的 404 隐藏入口）
  app.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({ code: "NOT_FOUND", message: COPY.common.notFound });
  });
}
