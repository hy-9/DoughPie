import Fastify from "fastify";

/**
 * Fastify 实例装配（与 listen 分离，供集成测试 inject 使用，conventions.md §5.1）。
 * 分层纪律：routes 薄 / services 厚；B1/B2 在此注册各域路由。
 */
export function buildApp() {
  const app = Fastify({
    // pino 日志：中文消息、request-id 贯穿（conventions.md §3.3）
    logger: true,
  });

  app.get("/api/v1/health", async () => ({ ok: true }));

  return app;
}
