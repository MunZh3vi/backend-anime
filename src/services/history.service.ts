import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import type { HistoryInput } from "../validators/list.validators";

export interface PaginatedHistory {
  items: Awaited<ReturnType<typeof prisma.watchHistoryEntry.findMany>>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listHistory(userId: string, page: number, limit: number): Promise<PaginatedHistory> {
  const [items, total] = await Promise.all([
    prisma.watchHistoryEntry.findMany({
      where: { userId },
      orderBy: { watchedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.watchHistoryEntry.count({ where: { userId } }),
  ]);

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function recordHistoryEntry(userId: string, input: HistoryInput) {
  return prisma.watchHistoryEntry.upsert({
    where: { userId_episodeId: { userId, episodeId: input.episodeId } },
    create: {
      userId,
      animeId: input.animeId,
      animeTitle: input.animeTitle,
      image: input.image,
      episodeId: input.episodeId,
      episodeTitle: input.episodeTitle,
      progressSeconds: input.progress,
      durationSeconds: input.duration,
    },
    update: {
      animeTitle: input.animeTitle,
      image: input.image,
      episodeTitle: input.episodeTitle,
      progressSeconds: input.progress,
      durationSeconds: input.duration,
      // watchedAt se actualiza solo por @updatedAt al tocar la fila.
    },
  });
}

export async function removeHistoryEntry(userId: string, episodeId: string): Promise<void> {
  const result = await prisma.watchHistoryEntry.deleteMany({ where: { userId, episodeId } });
  if (result.count === 0) {
    throw ApiError.notFound("El episodio no está en el historial");
  }
}
