import { Request, Response } from "express";
import * as commentService from "../services/comment.service";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import { CreateCommentInput, ListCommentsQuery, UpdateCommentInput } from "../validators/comment.validators";

export async function list(req: Request, res: Response) {
  const { animeId, episodeId, page, limit } = req.query as unknown as ListCommentsQuery;
  const result = await commentService.listComments(animeId, episodeId, page, limit, req.userId);
  sendSuccess(res, result);
}

export async function create(req: Request, res: Response) {
  const input = req.body as CreateCommentInput;
  const comment = await commentService.createComment(req.userId!, input);
  sendSuccess(res, comment, 201);
}

export async function update(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("id es requerido");
  const input = req.body as UpdateCommentInput;
  await commentService.updateComment(req.userId!, id, input);
  sendSuccess(res, { message: "Comentario actualizado" });
}

export async function remove(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("id es requerido");
  await commentService.deleteComment(req.userId!, id);
  sendSuccess(res, { message: "Comentario eliminado" });
}

export async function like(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("id es requerido");
  await commentService.likeComment(req.userId!, id);
  sendSuccess(res, { message: "Like agregado" });
}

export async function unlike(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("id es requerido");
  await commentService.unlikeComment(req.userId!, id);
  sendSuccess(res, { message: "Like removido" });
}
