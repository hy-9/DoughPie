import { buildApp } from "./app.js";

/** 入口：仅负责监听；装配逻辑在 app.ts */
const app = buildApp();

const port = Number(process.env.PORT ?? 8699);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err, "服务启动失败");
  process.exit(1);
});
