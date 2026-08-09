import { z } from "zod";

export const createCommentSchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
  episodeId: z.string().trim().min(1).optional(),
  parentId: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1, "El comentario no puede estar vacío").max(2000),
});

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1, "El comentario no puede estar vacío").max(2000),
});

export const listCommentsQuerySchema = z.object({
  animeId: z.string().trim().min(1, "animeId es requerido"),
  episodeId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reportCommentSchema = z.object({
  reason: z.string().trim().min(1, "El motivo es requerido").max(500),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
export type ReportCommentInput = z.infer<typeof reportCommentSchema>;
