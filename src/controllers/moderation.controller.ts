import { Request, Response } from "express";
import * as moderationService from "../services/moderation.service";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import { BanUserInput, ListReportsQuery, ResolveReportInput, SetRoleInput } from "../validators/moderation.validators";

export async function banUser(req: Request, res: Response) {
  const { userId } = req.params;
  if (!userId) throw ApiError.badRequest("userId es requerido");
  const input = req.body as BanUserInput;
  const user = await moderationService.banUser(userId, input.reason);
  sendSuccess(res, user);
}

export async function unbanUser(req: Request, res: Response) {
  const { userId } = req.params;
  if (!userId) throw ApiError.badRequest("userId es requerido");
  const user = await moderationService.unbanUser(userId);
  sendSuccess(res, user);
}

export async function setRole(req: Request, res: Response) {
  const { userId } = req.params;
  if (!userId) throw ApiError.badRequest("userId es requerido");
  const input = req.body as SetRoleInput;
  const user = await moderationService.setUserRole(userId, input.role);
  sendSuccess(res, user);
}

export async function listReports(req: Request, res: Response) {
  const { status, page, limit } = req.query as unknown as ListReportsQuery;
  const result = await moderationService.listReports(status, page, limit);
  sendSuccess(res, result);
}

export async function resolveReport(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("id es requerido");
  const input = req.body as ResolveReportInput;
  await moderationService.resolveReport(id, input.action);
  sendSuccess(res, { message: "Reporte resuelto" });
}
