import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { catalog, episode, info, resolve, search } from "../controllers/anime.controller";
import { proxyImage } from "../controllers/image.controller";
import { createBatch, createDownload, getBatch, getDownload } from "../controllers/download.controller";

export const animeRouter = Router();

/**
 * @openapi
 * /anime/image-proxy:
 *   get:
 *     summary: Proxy de imágenes (sin autenticación, evita bloqueos CORS)
 *     tags: [Utilidades]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Imagen servida (binario)
 *       400:
 *         description: URL inválida o host no permitido
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
animeRouter.get("/image-proxy", asyncHandler(proxyImage));

/**
 * @openapi
 * /anime/search:
 *   get:
 *     summary: Búsqueda de animes (unificada en todos los proveedores, o uno específico vía domain)
 *     tags: [Búsqueda]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: domain
 *         schema: { type: string }
 *         description: Dominio o id del proveedor (ej. animeflv, tioanime.com). Si se omite, busca en todos en paralelo.
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 source: { type: string, example: animeflv }
 *                 data:
 *                   type: object
 *                   properties:
 *                     query: { type: string }
 *                     count: { type: integer }
 *                     results:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/SearchResultItem' }
 */
animeRouter.get("/search", asyncHandler(search));

/**
 * @openapi
 * /anime/info:
 *   get:
 *     summary: Información de un anime (sinopsis, géneros, episodios)
 *     tags: [Detalle]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *         example: https://www3.animeflv.net/anime/one-piece
 *     responses:
 *       200:
 *         description: Información del anime
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 source: { type: string }
 *                 data: { $ref: '#/components/schemas/AnimeInfoData' }
 */
animeRouter.get("/info", asyncHandler(info));

/**
 * @openapi
 * /anime/episode:
 *   get:
 *     summary: Enlaces de streaming/descarga de un episodio
 *     tags: [Reproducción]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *         example: https://www3.animeflv.net/ver/one-piece-1122
 *       - in: query
 *         name: includeMega
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: excludeServers
 *         schema: { type: string }
 *         description: Servidores a excluir separados por coma
 *     responses:
 *       200:
 *         description: Enlaces del episodio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 source: { type: string }
 *                 data: { $ref: '#/components/schemas/EpisodeLinksData' }
 */
animeRouter.get("/episode", asyncHandler(episode));

/**
 * @openapi
 * /anime/catalog:
 *   get:
 *     summary: Catálogo / tendencias por proveedor
 *     tags: [Catálogo]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: provider
 *         schema: { type: string, enum: [animeav1, animeflv] }
 *         description: Proveedores con catálogo soportado (según el README de origen)
 *       - in: query
 *         name: genre
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Catálogo paginado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 source: { type: string }
 *                 data: { $ref: '#/components/schemas/CatalogData' }
 */
animeRouter.get("/catalog", asyncHandler(catalog));

/**
 * @openapi
 * /anime/resolve:
 *   get:
 *     summary: Resuelve un embed (StreamTape/VOE/StreamWish/etc.) a su URL directa reproducible
 *     tags: [Reproducción]
 *     parameters:
 *       - in: query
 *         name: url
 *         schema: { type: string }
 *       - in: query
 *         name: urls
 *         schema: { type: string }
 *         description: Array JSON de URLs a resolver en paralelo (se devuelve la primera que resuelva)
 *     responses:
 *       200:
 *         description: URL directa resuelta
 *       404:
 *         description: Ningún servidor pudo resolverse
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
animeRouter.get("/resolve", asyncHandler(resolve));

/**
 * @openapi
 * /anime/download:
 *   post:
 *     summary: Encola la descarga de un episodio a disco (guarda el archivo en el servidor)
 *     tags: [Descargas]
 *     responses:
 *       200:
 *         description: Descarga encolada
 */
animeRouter.post("/download", asyncHandler(createDownload));

/**
 * @openapi
 * /anime/download/{id}:
 *   get:
 *     summary: Estado de una descarga
 *     tags: [Descargas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Estado de la descarga
 */
animeRouter.get("/download/:id", asyncHandler(getDownload));

/**
 * @openapi
 * /anime/batch-download:
 *   post:
 *     summary: Encola la descarga de varios episodios de un anime
 *     tags: [Descargas]
 *     responses:
 *       200:
 *         description: Lote encolado
 */
animeRouter.post("/batch-download", asyncHandler(createBatch));

/**
 * @openapi
 * /anime/batch/{id}:
 *   get:
 *     summary: Estado de un lote de descargas
 *     tags: [Descargas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Estado del lote
 */
animeRouter.get("/batch/:id", asyncHandler(getBatch));
