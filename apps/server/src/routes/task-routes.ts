import {
  ROUTES,
  createTaskBodySchema,
  moveBodySchema,
  taskQuerySchema,
  updateTaskBodySchema,
  uuidSchema,
} from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody, parseIfMatch } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { TaskService } from "../services/task-service.js";

/**
 * 任务路由（薄）：P0-4/P0-14/P0-15。PATCH 必须带 If-Match: version（乐观锁，409 强制 refetch）。
 */
const workspaceParamsSchema = z.object({ wsId: uuidSchema });
const taskParamsSchema = z.object({ id: uuidSchema });

const workspaceTasksPath = `${ROUTES.workspaces}/:wsId/tasks`;
const taskPath = "/tasks/:id";
const taskMovePath = "/tasks/:id/move";

export function registerTaskRoutes(app: FastifyInstance, deps: { taskService: TaskService }): void {
  const { taskService } = deps;
  const auth = [app.authenticate];

  // 智能视图/四筛/搜索/排序/游标分页都走 query（taskQuerySchema）
  app.get(workspaceTasksPath, { preHandler: auth }, async (req) => {
    const { wsId } = parseBody(workspaceParamsSchema, req.params);
    const query = parseBody(taskQuerySchema, req.query);
    return taskService.queryTasks(requireUser(req).id, wsId, query);
  });

  app.post(workspaceTasksPath, { preHandler: auth }, async (req, reply) => {
    const { wsId } = parseBody(workspaceParamsSchema, req.params);
    const body = parseBody(createTaskBodySchema, req.body);
    return reply.status(201).send(await taskService.createTask(requireUser(req).id, wsId, body));
  });

  app.get(taskPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(taskParamsSchema, req.params);
    return taskService.getTask(requireUser(req).id, id);
  });

  app.patch(taskPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(taskParamsSchema, req.params);
    const body = parseBody(updateTaskBodySchema, req.body);
    return taskService.updateTask(
      requireUser(req).id,
      id,
      parseIfMatch(req.headers["if-match"]),
      body,
    );
  });

  app.delete(taskPath, { preHandler: auth }, async (req, reply) => {
    const { id } = parseBody(taskParamsSchema, req.params);
    await taskService.deleteTask(requireUser(req).id, id);
    return reply.status(204).send();
  });

  app.post(taskMovePath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(taskParamsSchema, req.params);
    const body = parseBody(moveBodySchema, req.body);
    return taskService.moveTask(requireUser(req).id, id, body);
  });
}
