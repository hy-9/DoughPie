import {
  commentQuerySchema,
  createCommentBodySchema,
  updateCommentBodySchema,
  uuidSchema,
} from "@doughpie/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import type { CommentService } from "../services/comment-service.js";

/** 讨论区路由（薄）：P0-17。评论 + 一级回复 + @提及；删除留 tombstone */
const taskParamsSchema = z.object({ taskId: uuidSchema });
const commentParamsSchema = z.object({ id: uuidSchema });

const taskCommentsPath = "/tasks/:taskId/comments";
const commentPath = "/comments/:id";

export function registerCommentRoutes(
  app: FastifyInstance,
  deps: { commentService: CommentService },
): void {
  const { commentService } = deps;
  const auth = [app.authenticate];

  app.get(taskCommentsPath, { preHandler: auth }, async (req) => {
    const { taskId } = parseBody(taskParamsSchema, req.params);
    const query = parseBody(commentQuerySchema, req.query);
    return commentService.listComments(requireUser(req).id, taskId, query);
  });

  app.post(taskCommentsPath, { preHandler: auth }, async (req, reply) => {
    const { taskId } = parseBody(taskParamsSchema, req.params);
    const body = parseBody(createCommentBodySchema, req.body);
    return reply
      .status(201)
      .send(await commentService.createComment(requireUser(req).id, taskId, body));
  });

  app.patch(commentPath, { preHandler: auth }, async (req) => {
    const { id } = parseBody(commentParamsSchema, req.params);
    const body = parseBody(updateCommentBodySchema, req.body);
    return commentService.updateComment(requireUser(req).id, id, body);
  });

  app.delete(commentPath, { preHandler: auth }, async (req, reply) => {
    const { id } = parseBody(commentParamsSchema, req.params);
    await commentService.deleteComment(requireUser(req).id, id);
    return reply.status(204).send();
  });
}
