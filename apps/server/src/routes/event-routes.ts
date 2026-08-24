import { cursorQuerySchema, uuidSchema } from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { EventService } from "../services/event-service.js";
import { requireCan } from "../services/workspace-guard.js";
import type { Db } from "../db.js";

/**
 * events 断线补齐路由（PLAN.md §4）：GET /workspaces/:id/events?cursor=&limit=
 * 游标 = 事件 id（string）；返回 cursor 之后的事件，按 id 升序。
 * D 阶段 socket 重连复用此数据源（正确性只依赖游标）。
 */
const workspaceParamsSchema = z.object({ id: uuidSchema });
const workspaceEventsPath = "/workspaces/:id/events";

export function registerEventRoutes(
  app: FastifyInstance,
  deps: { eventService: EventService; db: Db },
): void {
  const { eventService, db } = deps;
  const auth = [app.authenticate];

  app.get(workspaceEventsPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(workspaceParamsSchema, req.params);
    const query = parseBody(cursorQuerySchema, req.query);
    // 三角色均可读（viewer 只读）；非成员 403
    await requireCan(db, id, requireUser(req).id, "event.read");
    return eventService.listEvents(id, query);
  });
}
