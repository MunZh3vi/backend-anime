import { Request, Response } from "express";
import * as notificationService from "../services/notification.service";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import { ListNotificationsQuery } from "../validators/notification.validators";

export async function list(req: Request, res: Response) {
  const { page, limit, unreadOnly } = req.query as unknown as ListNotificationsQuery;
  const result = await notificationService.listNotifications(req.userId!, page, limit, unreadOnly);
  sendSuccess(res, result);
}

export async function markRead(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("id es requerido");
  await notificationService.markRead(req.userId!, id);
  sendSuccess(res, { message: "Notificación marcada como leída" });
}

export async function markAllRead(req: Request, res: Response) {
  await notificationService.markAllRead(req.userId!);
  sendSuccess(res, { message: "Todas las notificaciones marcadas como leídas" });
}
