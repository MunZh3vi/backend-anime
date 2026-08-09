import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
} from "../validators/user.validators";
import { disableTwoFactorSchema, enableTwoFactorSchema } from "../validators/twoFactor.validators";
import { historyBodySchema, listItemBodySchema, paginationQuerySchema } from "../validators/list.validators";
import * as profileController from "../controllers/profile.controller";
import * as twoFactorController from "../controllers/twoFactor.controller";
import * as favoritesController from "../controllers/favorites.controller";
import * as watchlistController from "../controllers/watchlist.controller";
import * as historyController from "../controllers/history.controller";

export const userRouter = Router();

userRouter.use(authenticate);

/**
 * @openapi
 * /user/profile:
 *   get:
 *     summary: Obtener el perfil del usuario autenticado
 *     tags: [Perfil]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Perfil del usuario }
 *       401: { description: No autenticado }
 *   put:
 *     summary: Actualizar el perfil (username, avatar, bio)
 *     tags: [Perfil]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username: { type: string }
 *               avatarUrl: { type: string }
 *               bio: { type: string }
 *     responses:
 *       200: { description: Perfil actualizado }
 */
userRouter.get("/profile", asyncHandler(profileController.getProfile));
userRouter.put("/profile", validate(updateProfileSchema), asyncHandler(profileController.updateProfile));

/**
 * @openapi
 * /user/change-password:
 *   put:
 *     summary: Cambiar la contraseña (invalida las sesiones activas)
 *     tags: [Perfil]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200: { description: Contraseña actualizada }
 */
userRouter.put("/change-password", validate(changePasswordSchema), asyncHandler(profileController.changePassword));

/**
 * @openapi
 * /user/email:
 *   put:
 *     summary: Cambiar el email (requiere contraseña, vuelve a pedir verificación)
 *     tags: [Perfil]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newEmail, password]
 *             properties:
 *               newEmail: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200: { description: Email actualizado (isEmailVerified vuelve a false) }
 *       409: { description: Ese email ya está en uso }
 */
userRouter.put("/email", validate(changeEmailSchema), asyncHandler(profileController.changeEmail));

/**
 * @openapi
 * /user/sessions:
 *   get:
 *     summary: Listar sesiones activas (refresh tokens vigentes) de la cuenta
 *     tags: [Sesiones]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Lista de sesiones, con isCurrent marcando la que estás usando ahora }
 *   delete:
 *     summary: Cerrar todas las sesiones menos la actual
 *     tags: [Sesiones]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Sesiones cerradas }
 */
userRouter.get("/sessions", asyncHandler(profileController.listSessions));
userRouter.delete("/sessions", asyncHandler(profileController.revokeOtherSessions));

/**
 * @openapi
 * /user/sessions/{id}:
 *   delete:
 *     summary: Cerrar una sesión específica
 *     tags: [Sesiones]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Sesión cerrada }
 *       404: { description: No existe esa sesión }
 */
userRouter.delete("/sessions/:id", asyncHandler(profileController.revokeSession));

/**
 * @openapi
 * /user/2fa/setup:
 *   post:
 *     summary: Generar un secreto TOTP nuevo + QR para activar 2FA (no lo activa todavía)
 *     tags: [2FA]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: Secreto y QR para escanear con la app authenticator
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     secret: { type: string }
 *                     otpauthUrl: { type: string }
 *                     qrCodeDataUrl: { type: string, description: "Data URL de imagen PNG, listo para <img src>" }
 */
userRouter.post("/2fa/setup", asyncHandler(twoFactorController.setup));

/**
 * @openapi
 * /user/2fa/enable:
 *   post:
 *     summary: Confirmar y activar 2FA (mandar el secret de /2fa/setup + un código válido)
 *     tags: [2FA]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [secret, code]
 *             properties:
 *               secret: { type: string }
 *               code: { type: string }
 *     responses:
 *       200: { description: 2FA activado }
 *       400: { description: Código incorrecto }
 */
userRouter.post("/2fa/enable", validate(enableTwoFactorSchema), asyncHandler(twoFactorController.enable));

/**
 * @openapi
 * /user/2fa/disable:
 *   post:
 *     summary: Desactivar 2FA (requiere contraseña + un código válido)
 *     tags: [2FA]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password, code]
 *             properties:
 *               password: { type: string }
 *               code: { type: string }
 *     responses:
 *       200: { description: 2FA desactivado }
 */
userRouter.post("/2fa/disable", validate(disableTwoFactorSchema), asyncHandler(twoFactorController.disable));

/**
 * @openapi
 * /user/delete-account:
 *   delete:
 *     summary: Eliminar la cuenta (requiere contraseña)
 *     tags: [Perfil]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       200: { description: Cuenta eliminada }
 */
userRouter.delete("/delete-account", validate(deleteAccountSchema), asyncHandler(profileController.deleteAccount));

/**
 * @openapi
 * /user/favorites:
 *   get:
 *     summary: Listar favoritos
 *     tags: [Favoritos]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Lista de favoritos }
 *   post:
 *     summary: Añadir anime a favoritos
 *     tags: [Favoritos]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [animeId, title]
 *             properties:
 *               animeId: { type: string }
 *               title: { type: string }
 *               image: { type: string }
 *               rating: { type: number }
 *               type: { type: string }
 *     responses:
 *       201: { description: Añadido a favoritos }
 */
userRouter.get("/favorites", asyncHandler(favoritesController.list));
userRouter.post("/favorites", validate(listItemBodySchema), asyncHandler(favoritesController.add));

/**
 * @openapi
 * /user/favorites/{animeId}:
 *   delete:
 *     summary: Eliminar anime de favoritos
 *     tags: [Favoritos]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: animeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Eliminado de favoritos }
 *       404: { description: No estaba en favoritos }
 */
userRouter.delete("/favorites/:animeId", asyncHandler(favoritesController.remove));

/**
 * @openapi
 * /user/watchlist:
 *   get:
 *     summary: Listar watchlist ("ver después")
 *     tags: [Watchlist]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200: { description: Lista de watchlist }
 *   post:
 *     summary: Añadir anime a la watchlist
 *     tags: [Watchlist]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [animeId, title]
 *             properties:
 *               animeId: { type: string }
 *               title: { type: string }
 *               image: { type: string }
 *               rating: { type: number }
 *               type: { type: string }
 *     responses:
 *       201: { description: Añadido a la watchlist }
 */
userRouter.get("/watchlist", asyncHandler(watchlistController.list));
userRouter.post("/watchlist", validate(listItemBodySchema), asyncHandler(watchlistController.add));

/**
 * @openapi
 * /user/watchlist/{animeId}:
 *   delete:
 *     summary: Eliminar anime de la watchlist
 *     tags: [Watchlist]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: animeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Eliminado de la watchlist }
 *       404: { description: No estaba en la watchlist }
 */
userRouter.delete("/watchlist/:animeId", asyncHandler(watchlistController.remove));

/**
 * @openapi
 * /user/history:
 *   get:
 *     summary: Historial de visualización (paginado)
 *     tags: [Historial]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200: { description: Historial paginado }
 *   post:
 *     summary: Registrar visualización de un episodio (upsert por episodio)
 *     tags: [Historial]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [animeId, animeTitle, episodeId, episodeTitle]
 *             properties:
 *               animeId: { type: string }
 *               animeTitle: { type: string }
 *               image: { type: string, description: "URL absoluta o ruta ya proxeada (/api/v1/anime/image-proxy?u=...)" }
 *               episodeId: { type: string }
 *               episodeTitle: { type: string }
 *               progress: { type: integer, description: "Segundos vistos" }
 *               duration: { type: integer, description: "Duración total del episodio en segundos, para calcular el % visto" }
 *     responses:
 *       201: { description: Visualización registrada }
 */
userRouter.get("/history", validate(paginationQuerySchema, "query"), asyncHandler(historyController.list));
userRouter.post("/history", validate(historyBodySchema), asyncHandler(historyController.record));

/**
 * @openapi
 * /user/history/{episodeId}:
 *   delete:
 *     summary: Eliminar un episodio del historial
 *     tags: [Historial]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: episodeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Eliminado del historial }
 *       404: { description: No estaba en el historial }
 */
userRouter.delete("/history/:episodeId", asyncHandler(historyController.remove));
