import { Request, Response } from "express";
import * as ratingService from "../services/rating.service";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import { UpsertRatingInput } from "../validators/rating.validators";

export async function get(req: Request, res: Response) {
  const { animeId } = req.query as { animeId: string };
  const summary = await ratingService.getRatingSummary(animeId, req.userId);
  sendSuccess(res, summary);
}

export async function upsert(req: Request, res: Response) {
  const input = req.body as UpsertRatingInput;
  const summary = await ratingService.upsertRating(req.userId!, input.animeId, input.score);
  sendSuccess(res, summary, 201);
}

export async function remove(req: Request, res: Response) {
  const { animeId } = req.params;
  if (!animeId) throw ApiError.badRequest("animeId es requerido");
  await ratingService.removeRating(req.userId!, animeId);
  sendSuccess(res, { message: "Calificación eliminada" });
}
