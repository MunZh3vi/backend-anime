import { Request, Response } from "express";
import * as watchlistService from "../services/watchlist.service";
import { sendSuccess } from "../utils/response";
import { ListItemInput } from "../validators/list.validators";
import { ApiError } from "../utils/ApiError";

export async function list(req: Request, res: Response) {
  const watchlist = await watchlistService.listWatchlist(req.userId!);
  sendSuccess(res, { watchlist, total: watchlist.length });
}

export async function add(req: Request, res: Response) {
  const input = req.body as ListItemInput;
  const item = await watchlistService.addToWatchlist(req.userId!, input);
  sendSuccess(res, item, 201);
}

export async function remove(req: Request, res: Response) {
  const { animeId } = req.params;
  if (!animeId) throw ApiError.badRequest("animeId es requerido");
  await watchlistService.removeFromWatchlist(req.userId!, animeId);
  sendSuccess(res, { message: "Eliminado de la watchlist" });
}
