import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, optionalAuthenticate } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { ratingQuerySchema, upsertRatingSchema } from "../validators/rating.validators";
import * as ratingController from "../controllers/rating.controller";

export const ratingRouter = Router();

/**
 * @openapi
 * /ratings:
 *   get:
 *     summary: Nota de la comunidad para un anime (promedio + cantidad de votos), separada del score del proveedor
 *     tags: [Calificaciones]
 *     parameters:
 *       - in: query
 *         name: animeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Resumen de calificación
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     animeId: { type: string }
 *                     average: { type: number, nullable: true }
 *                     count: { type: integer }
 *                     myScore: { type: integer, nullable: true, description: "Tu propia nota, null si no calificaste o no estás logueado" }
 *   post:
 *     summary: Calificar un anime (1-10). Upsert - repetir sobrescribe tu nota anterior.
 *     tags: [Calificaciones]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [animeId, score]
 *             properties:
 *               animeId: { type: string }
 *               score: { type: integer, minimum: 1, maximum: 10 }
 *     responses:
 *       201: { description: Calificación guardada, devuelve el resumen actualizado }
 */
ratingRouter.get("/", optionalAuthenticate, validate(ratingQuerySchema, "query"), asyncHandler(ratingController.get));
ratingRouter.post("/", authenticate, validate(upsertRatingSchema), asyncHandler(ratingController.upsert));

/**
 * @openapi
 * /ratings/{animeId}:
 *   delete:
 *     summary: Eliminar tu propia calificación de un anime
 *     tags: [Calificaciones]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: animeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Calificación eliminada }
 *       404: { description: No habías calificado este anime }
 */
ratingRouter.delete("/:animeId", authenticate, asyncHandler(ratingController.remove));
