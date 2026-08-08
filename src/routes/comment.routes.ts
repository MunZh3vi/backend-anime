import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, optionalAuthenticate } from "../middlewares/authenticate";
import { validate } from "../middlewares/validate";
import { createCommentSchema, listCommentsQuerySchema, updateCommentSchema } from "../validators/comment.validators";
import * as commentController from "../controllers/comment.controller";

export const commentRouter = Router();

/**
 * @openapi
 * /comments:
 *   get:
 *     summary: Listar comentarios de un anime (o de un episodio puntual), con hilos de respuestas
 *     tags: [Comentarios]
 *     parameters:
 *       - in: query
 *         name: animeId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: episodeId
 *         schema: { type: string }
 *         description: Si se omite, trae los comentarios generales del anime (no de un episodio)
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Comentarios de primer nivel paginados, cada uno con sus respuestas anidadas en "replies" }
 *   post:
 *     summary: Crear un comentario (o una respuesta, si se manda parentId)
 *     tags: [Comentarios]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [animeId, content]
 *             properties:
 *               animeId: { type: string }
 *               episodeId: { type: string }
 *               parentId: { type: string, description: "Id del comentario al que se responde" }
 *               content: { type: string }
 *     responses:
 *       201: { description: Comentario creado }
 */
commentRouter.get("/", optionalAuthenticate, validate(listCommentsQuerySchema, "query"), asyncHandler(commentController.list));
commentRouter.post("/", authenticate, validate(createCommentSchema), asyncHandler(commentController.create));

/**
 * @openapi
 * /comments/{id}:
 *   put:
 *     summary: Editar el contenido de un comentario propio
 *     tags: [Comentarios]
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
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       200: { description: Comentario actualizado }
 *   delete:
 *     summary: Eliminar un comentario propio (borrado lógico, conserva las respuestas del hilo)
 *     tags: [Comentarios]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Comentario eliminado }
 */
commentRouter.put("/:id", authenticate, validate(updateCommentSchema), asyncHandler(commentController.update));
commentRouter.delete("/:id", authenticate, asyncHandler(commentController.remove));

/**
 * @openapi
 * /comments/{id}/like:
 *   post:
 *     summary: Dar like a un comentario
 *     tags: [Comentarios]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Like agregado }
 *   delete:
 *     summary: Quitar el like de un comentario
 *     tags: [Comentarios]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Like removido }
 */
commentRouter.post("/:id/like", authenticate, asyncHandler(commentController.like));
commentRouter.delete("/:id/like", authenticate, asyncHandler(commentController.unlike));
