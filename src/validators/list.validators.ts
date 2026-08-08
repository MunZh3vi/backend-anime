import { z } from "zod";

// Compartido por favorites y watchlist: ambos guardan el mismo "snapshot"
// liviano del anime (id/title/image/rating/type) tal como lo devuelve el
// scraper, sin depender de una tabla de animes propia.
export const listItemBodySchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
  title: z.string().trim().min(1, "title es requerido"),
  image: z.string().trim().url().optional(),
  rating: z.number().min(0).max(10).optional(),
  type: z.string().trim().max(50).optional(),
});

export const historyBodySchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
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
