import { z } from "zod";

// Acepta tanto una URL absoluta como una ruta relativa ya proxeada por
// nuestra propia API (ej. "/api/v1/anime/image-proxy?u=..."), que es lo que
// el frontend recibe de /search, /info y /catalog y probablemente reenvíe
// tal cual al guardar un favorito/watchlist/historial.
const imageFieldSchema = z.string().trim().min(1).max(2000);

// Compartido por favorites y watchlist: ambos guardan el mismo "snapshot"
// liviano del anime (id/title/image/rating/type) tal como lo devuelve el
// scraper, sin depender de una tabla de animes propia.
export const listItemBodySchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
  title: z.string().trim().min(1, "title es requerido"),
  image: imageFieldSchema.optional(),
  rating: z.number().min(0).max(10).optional(),
  type: z.string().trim().max(50).optional(),
});

export const historyBodySchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
  animeTitle: z.string().trim().min(1, "animeTitle es requerido"),
  image: imageFieldSchema.optional(),
  episodeId: z.string().trim().min(1, "episodeId es requerido"),
  episodeTitle: z.string().trim().min(1, "episodeTitle es requerido"),
  progress: z.number().int().min(0).optional(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type ListItemInput = z.infer<typeof listItemBodySchema>;
export type HistoryInput = z.infer<typeof historyBodySchema>;
