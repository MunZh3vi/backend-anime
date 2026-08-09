import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { catalog, episode, genres, info, resolve, search, status, trending } from "../controllers/anime.controller";
import { proxyImage } from "../controllers/image.controller";
import { createBatch, createDownload, getBatch, getDownload } from "../controllers/download.controller";
import { optionalAuthenticate } from "../middlewares/authenticate";

export const animeRouter = Router();

/**
 * @openapi
 * /v1/anime/status:
 *   get:
 *     summary: Estado en vivo de cada proveedor de scraping (búsqueda y, para AnimeFLV/AnimeAV1, si hay servidores de video reales)
 *     tags: [Utilidades]
 *     description: Corre una búsqueda de prueba en cada proveedor y, para AnimeFLV/AnimeAV1, además revisa un episodio fijo (Naruto ep. 1) para saber si hay enlaces de video reales. Resultado cacheado 60s.
 *     responses:
 *       200:
 *         description: Estado por proveedor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     checkedAt: { type: string, format: date-time }
 *                     providers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           provider: { type: string, example: animeflv }
 *                           label: { type: string, example: AnimeFLV }
 *                           search:
 *                             type: object
 *                             properties:
 *                               ok: { type: boolean }
 *                               resultCount: { type: integer }
 *                               responseTimeMs: { type: integer }
 *                               error: { type: string, nullable: true }
 *                           episodes:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               ok: { type: boolean }
 *                               hasVideoLinks: { type: boolean }
 *                               responseTimeMs: { type: integer }
 *                               error: { type: string, nullable: true }
 */
animeRouter.get("/status", asyncHandler(status));

/**
 * @openapi
 * /v1/anime/image-proxy:
 *   get:
 *     summary: Proxy de imágenes (sin autenticación, evita bloqueos CORS)
 *     description: No se llama a mano — los campos "image"/"backdrop" que devuelven /search, /info y /catalog ya vienen con esta ruta y el token cifrado incluidos, ocultando el dominio real de la fuente.
 *     tags: [Utilidades]
 *     parameters:
 *       - in: query
 *         name: u
 *         required: true
 *         schema: { type: string }
 *         description: Token cifrado (AES-256-GCM) generado por el backend, no una URL en texto plano.
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
 * /v1/anime/search:
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
animeRouter.get("/search", optionalAuthenticate, asyncHandler(search));

/**
 * @openapi
 * /v1/anime/info:
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
animeRouter.get("/info", optionalAuthenticate, asyncHandler(info));

/**
 * @openapi
 * /v1/anime/episode:
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
animeRouter.get("/episode", optionalAuthenticate, asyncHandler(episode));

/**
 * @openapi
 * /v1/anime/catalog:
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
animeRouter.get("/catalog", optionalAuthenticate, asyncHandler(catalog));

/**
 * @openapi
 * /v1/anime/trending:
 *   get:
 *     summary: Ranking propio de "más visto" armado con el historial real de reproducción de los usuarios
 *     tags: [Catálogo]
 *     description: A diferencia de /catalog (que refleja el orden que trae el proveedor), esto cuenta reproducciones reales en la ventana de tiempo indicada.
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 7, minimum: 1, maximum: 30 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, minimum: 1, maximum: 50 }
 *     responses:
 *       200:
 *         description: Lista ordenada por cantidad de usuarios distintos que lo vieron
 */
animeRouter.get("/trending", optionalAuthenticate, asyncHandler(trending));

/**
 * @openapi
 * /v1/anime/genres:
 *   get:
 *     summary: Lista curada de géneros para poblar un filtro (no viene de scraping en vivo)
 *     tags: [Catálogo]
 *     description: Los slugs coinciden con los que espera /catalog?provider=animeflv&genre=<slug>. Es una lista estática mantenida a mano, no un scrape en vivo (ninguna fuente expone esto en HTML sin JS).
 *     responses:
 *       200:
 *         description: Lista de géneros
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       slug: { type: string, example: accion }
 *                       name: { type: string, example: Acción }
 */
animeRouter.get("/genres", asyncHandler(genres));

/**
 * @openapi
 * /v1/anime/resolve:
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
 * /v1/anime/download:
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
 * /v1/anime/download/{id}:
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
 * /v1/anime/batch-download:
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
 * /v1/anime/batch/{id}:
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
