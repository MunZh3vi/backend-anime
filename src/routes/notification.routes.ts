import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { listNotificationsQuerySchema } from "../validators/notification.validators";
import * as notificationController from "../controllers/notification.controller";

export const notificationRouter = Router();

notificationRouter.use(authenticate);

/**
 * @openapi
 * /notifications:
 *   get:
 *     summary: Listar tus notificaciones (respuestas a comentarios, nuevos episodios de tu watchlist)
 *     tags: [Notificaciones]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200: { description: Notificaciones paginadas, con unreadCount aparte }
 */
notificationRouter.get("/", validate(listNotificationsQuerySchema, "query"), asyncHandler(notificationController.list));

/**
 * @openapi
 * /notifications/read-all:
 *   post:
 *     summary: Marcar todas las notificaciones como leídas
 *     tags: [Notificaciones]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Listo }
 */
notificationRouter.post("/read-all", asyncHandler(notificationController.markAllRead));

/**
 * @openapi
 * /notifications/{id}/read:
 *   post:
 *     summary: Marcar una notificación como leída
 *     tags: [Notificaciones]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Listo }
 *       404: { description: No existe esa notificación }
 */
notificationRouter.post("/:id/read", asyncHandler(notificationController.markRead));
