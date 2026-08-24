import { createSubtaskBodySchema, updateSubtaskBodySchema, uuidSchema } from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { SubtaskService } from "../services/subtask-service.js";

/** 子任务路由（薄）：P0-9。每任务 ≤50 个，超限 409 SUBTASK_LIMIT */
const taskParamsSchema = z.object({ taskId: uuidSchema });
const subtaskParamsSchema = z.object({ id: uuidSchema });

const taskSubtasksPath = "/tasks/:taskId/subtasks";
const subtaskPath = "/subtasks/:id";

export function registerSubtaskRoutes(
  app: FastifyInstance,
  deps: { subtaskService: SubtaskService },
): void {
  const { subtaskService } = deps;
  const auth = [app.authenticate];

  app.get(taskSubtasksPath, { preHandler: auth }, async (req) => {
    const { taskId } = parseBody(taskParamsSchema, req.params);
    return subtaskService.listSubtasks(requireUser(req).id, taskId);
  });

  app.post(taskSubtasksPath, { preHandler: auth }, async (req, reply) => {
    const { taskId } = parseBody(taskParamsSchema, req.params);
    const body = parseBody(createSubtaskBodySchema, req.body);
    return reply
      .status(201)
      .send(await subtaskService.createSubtask(requireUser(req).id, taskId, body));
  });

  app.patch(subtaskPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(subtaskParamsSchema, req.params);
    const body = parseBody(updateSubtaskBodySchema, req.body);
    return subtaskService.updateSubtask(requireUser(req).id, id, body);
  });

  app.delete(subtaskPath, { preHandler: auth }, async (req, reply) => {
    const { id } = parseBody(subtaskParamsSchema, req.params);
    await subtaskService.deleteSubtask(requireUser(req).id, id);
    return reply.status(204).send();
  });
}
