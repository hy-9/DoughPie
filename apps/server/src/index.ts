import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

/** 入口：仅负责监听；装配逻辑在 app.ts。env 校验失败即退出，不带病运行。 */
const env = loadEnv();
const app = await buildApp({ env });

try {
  await app.listen({ port: env.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err, "服务启动失败");
  process.exit(1);
}
