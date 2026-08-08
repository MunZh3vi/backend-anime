import { Request, Response } from "express";
import * as historyService from "../services/history.service";
import { sendSuccess } from "../utils/response";
import { HistoryInput } from "../validators/list.validators";
import { ApiError } from "../utils/ApiError";

export async function list(req: Request, res: Response) {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  const result = await historyService.listHistory(req.userId!, page, limit);
  sendSuccess(res, result);
}

export async function record(req: Request, res: Response) {
  const input = req.body as HistoryInput;
  const entry = await historyService.recordHistoryEntry(req.userId!, input);
  sendSuccess(res, entry, 201);
}

export async function remove(req: Request, res: Response) {
  const { episodeId } = req.params;
  if (!episodeId) throw ApiError.badRequest("episodeId es requerido");
  await historyService.removeHistoryEntry(req.userId!, episodeId);
  sendSuccess(res, { message: "Eliminado del historial" });
}
