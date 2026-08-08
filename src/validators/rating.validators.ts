import { z } from "zod";

export const upsertRatingSchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
  score: z.number().int().min(1, "La nota mínima es 1").max(10, "La nota máxima es 10"),
});

export const ratingQuerySchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
});

export type UpsertRatingInput = z.infer<typeof upsertRatingSchema>;
