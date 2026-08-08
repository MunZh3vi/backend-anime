import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { optionalAuthenticate } from "../middlewares/authenticate";
import { getFavorites, getProfile } from "../controllers/publicProfile.controller";

export const publicUsersRouter = Router();

// optionalAuthenticate (no authenticate): un perfil público debe poder verse
// sin sesión; si hay sesión, sirve para detectar "estás viendo tu propio
// perfil" y mostrar el contenido privado igual.
publicUsersRouter.use(optionalAuthenticate);

/**
 * @openapi
 * /users/{username}:
 *   get:
 *     summary: Perfil público de un usuario, por su username
 *     tags: [Perfil Público]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Perfil público. "stats" viene null si el perfil no es visible para quien pregunta (privado y no sos el dueño).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     username: { type: string }
 *                     avatarUrl: { type: string, nullable: true }
 *                     bio: { type: string, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     profileVisibility: { type: string, enum: [PUBLIC, FRIENDS, PRIVATE] }
 *                     stats:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         series: { type: integer }
 *                         episodes: { type: integer }
 *                         hours: { type: number }
 *       404: { description: No existe ese usuario }
 */
publicUsersRouter.get("/:username", asyncHandler(getProfile));

/**
 * @openapi
 * /users/{username}/favorites:
 *   get:
 *     summary: Favoritos públicos de un usuario (solo si su perfil es público, o si sos el dueño)
 *     tags: [Perfil Público]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Lista de favoritos }
 *       403: { description: El perfil es privado }
 *       404: { description: No existe ese usuario }
 */
publicUsersRouter.get("/:username/favorites", asyncHandler(getFavorites));
