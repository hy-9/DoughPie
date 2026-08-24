import {
  ROUTES,
  createListBodySchema,
  moveBodySchema,
  updateListBodySchema,
  uuidSchema,
} from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { ListService } from "../services/list-service.js";

/** 清单路由（薄）：P0-3。业务逻辑全在 listService */
const workspaceParamsSchema = z.object({ wsId: uuidSchema });
const listParamsSchema = z.object({ id: uuidSchema });

const workspaceListsPath = `${ROUTES.workspaces}/:wsId/lists`;
const listPath = "/lists/:id";
const listMovePath = "/lists/:id/move";

export function registerListRoutes(app: FastifyInstance, deps: { listService: ListService }): void {
  const { listService } = deps;
  const auth = [app.authenticate];

  app.get(workspaceListsPath, { preHandler: auth }, async (req) => {
    const { wsId } = parseBody(workspaceParamsSchema, req.params);
    return listService.listLists(requireUser(req).id, wsId);
  });

  app.post(workspaceListsPath, { preHandler: auth }, async (req, reply) => {
    const { wsId } = parseBody(workspaceParamsSchema, req.params);
    const body = parseBody(createListBodySchema, req.body);
    return reply.status(201).send(await listService.createList(requireUser(req).id, wsId, body));
  });

  app.patch(listPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(listParamsSchema, req.params);
    const body = parseBody(updateListBodySchema, req.body);
    return listService.updateList(requireUser(req).id, id, body);
  });

  app.delete(listPath, { preHandler: auth }, async (req, reply) => {
    const { id } = parseBody(listParamsSchema, req.params);
    await listService.deleteList(requireUser(req).id, id);
    return reply.status(204).send();
  });

  app.post(listMovePath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(listParamsSchema, req.params);
    const body = parseBody(moveBodySchema, req.body);
    return listService.moveList(requireUser(req).id, id, body);
  });
}
