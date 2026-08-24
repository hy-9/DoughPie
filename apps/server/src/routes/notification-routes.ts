import { ROUTES, markReadBodySchema, notificationQuerySchema, uuidSchema } from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { NotificationService } from "../services/notification-service.js";

/**
 * 通知路由（薄）：PLAN.md §5。通知中心列表 / 手动已读 / 提及确认 / 提及再提醒（24h 节流）。
 */
const notificationParamsSchema = z.object({ id: uuidSchema });
const mentionRemindParamsSchema = z.object({ taskId: uuidSchema, userId: uuidSchema });

const notificationAckPath = `${ROUTES.notifications}/:id/ack`;
const mentionRemindPath = "/tasks/:taskId/mentions/:userId/remind";

export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: { notificationService: NotificationService },
): void {
  const { notificationService } = deps;
  const auth = [app.authenticate];

  app.get(ROUTES.notifications, { preHandler: auth }, async (req) => {
    const query = parseBody(notificationQuerySchema, req.query);
    return notificationService.listNotifications(requireUser(req).id, query);
  });

  app.post(ROUTES.notificationsRead, { preHandler: auth }, async (req, reply) => {
    const body = parseBody(markReadBodySchema, req.body);
    await notificationService.markRead(requireUser(req).id, body.ids);
    return reply.status(204).send();
  });

  // 提及确认闭环（§5.5）：仅 mention 类型、仅属主；置 read_at+ack_at 并写 mention.acked 事件
  app.post(notificationAckPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(notificationParamsSchema, req.params);
    return notificationService.ack(requireUser(req).id, id);
  });

  // 发起者对未确认提及「再提醒」（24h 节流，命中 → 429）
  app.post(mentionRemindPath, { preHandler: auth }, async (req, reply) => {
    const { taskId, userId } = parseBody(mentionRemindParamsSchema, req.params);
    await notificationService.remindMention(requireUser(req).id, taskId, userId);
    return reply.status(204).send();
  });
}
