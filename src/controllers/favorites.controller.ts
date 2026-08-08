import { Request, Response } from "express";
import * as favoritesService from "../services/favorites.service";
import { sendSuccess } from "../utils/response";
import { ListItemInput } from "../validators/list.validators";
import { ApiError } from "../utils/ApiError";

export async function list(req: Request, res: Response) {
  const favorites = await favoritesService.listFavorites(req.userId!);
  sendSuccess(res, { favorites, total: favorites.length });
}

export async function add(req: Request, res: Response) {
  const input = req.body as ListItemInput;
  const favorite = await favoritesService.addFavorite(req.userId!, input);
  sendSuccess(res, favorite, 201);
}

export async function remove(req: Request, res: Response) {
  const { animeId } = req.params;
  if (!animeId) throw ApiError.badRequest("animeId es requerido");
  await favoritesService.removeFavorite(req.userId!, animeId);
  sendSuccess(res, { message: "Eliminado de favoritos" });
}
