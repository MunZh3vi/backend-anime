import { Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/response";
import * as downloadService from "../services/download.service";

function baseUrlFrom(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

export async function createDownload(req: Request, res: Response) {
  const data = downloadService.createDownload(req.body || {}, baseUrlFrom(req));
  sendSuccess(res, data);
}

export async function getDownload(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) throw ApiError.badRequest("Se requiere el id de la descarga");
  const data = downloadService.getDownload(id);
  sendSuccess(res, data);
}

export async function createBatch(req: Request, res: Response) {
  const data = downloadService.createBatch(req.body || {}, baseUrlFrom(req));
  sendSuccess(res, data);
}

export async function getBatch(req: Request, res: Response) {
  const id = req.params.id;
  if (!id) throw ApiError.badRequest("Se requiere el id del lote");
  const data = downloadService.getBatch(id);
  sendSuccess(res, data);
}
