import { Request, Response } from "express";
import * as publicProfileService from "../services/publicProfile.service";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";

export async function getProfile(req: Request, res: Response) {
  const { username } = req.params;
  if (!username) throw ApiError.badRequest("username es requerido");

  const profile = await publicProfileService.getPublicProfile(username, req.userId);
  sendSuccess(res, profile);
}

export async function getFavorites(req: Request, res: Response) {
  const { username } = req.params;
  if (!username) throw ApiError.badRequest("username es requerido");

  const favorites = await publicProfileService.listFavoritesByUsername(username, req.userId);
  sendSuccess(res, { favorites, total: favorites.length });
}
