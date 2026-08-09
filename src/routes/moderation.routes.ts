import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import {
  banUserSchema,
  listReportsQuerySchema,
  resolveReportSchema,
  setRoleSchema,
} from "../validators/moderation.validators";
import * as moderationController from "../controllers/moderation.controller";

export const moderationRouter = Router();

// Todo lo que cuelga de acá exige estar logueado Y ser MODERATOR o ADMIN
// (setRole exige ADMIN puntualmente, ver más abajo).
moderationRouter.use(authenticate, requireRole("MODERATOR", "ADMIN"));

/**
 * @openapi
 * /moderation/users/{userId}/ban:
 *   post:
 *     summary: Suspender una cuenta (revoca sus sesiones activas)
 *     tags: [Moderación]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Usuario suspendido }
 *       403: { description: No se puede banear a un admin }
 */
moderationRouter.post("/users/:userId/ban", validate(banUserSchema), asyncHandler(moderationController.banUser));

/**
 * @openapi
 * /moderation/users/{userId}/unban:
 *   post:
 *     summary: Levantar la suspensión de una cuenta
 *     tags: [Moderación]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Suspensión levantada }
 */
moderationRouter.post("/users/:userId/unban", asyncHandler(moderationController.unbanUser));

/**
 * @openapi
 * /moderation/users/{userId}/role:
 *   put:
 *     summary: Cambiar el rol de un usuario (solo ADMIN)
 *     tags: [Moderación]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [USER, MODERATOR, ADMIN] }
 *     responses:
 *       200: { description: Rol actualizado }
 *       403: { description: Solo un ADMIN puede cambiar roles }
 */
moderationRouter.put(
  "/users/:userId/role",
  requireRole("ADMIN"),
  validate(setRoleSchema),
  asyncHandler(moderationController.setRole)
);

/**
 * @openapi
 * /moderation/reports:
 *   get:
 *     summary: Cola de reportes de comentarios
 *     tags: [Moderación]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, RESOLVED, DISMISSED], default: PENDING }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Reportes paginados, con el comentario y quién lo reportó }
 */
moderationRouter.get("/reports", validate(listReportsQuerySchema, "query"), asyncHandler(moderationController.listReports));

/**
 * @openapi
 * /moderation/reports/{id}/resolve:
 *   post:
 *     summary: Resolver un reporte (descartarlo o borrar el comentario reportado)
 *     tags: [Moderación]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action: { type: string, enum: [dismiss, delete_comment] }
 *     responses:
 *       200: { description: Reporte resuelto }
 */
moderationRouter.post(
  "/reports/:id/resolve",
  validate(resolveReportSchema),
  asyncHandler(moderationController.resolveReport)
);
