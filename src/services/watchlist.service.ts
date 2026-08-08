import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import type { ListItemInput } from "../validators/list.validators";

export function listWatchlist(userId: string) {
  return prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function addToWatchlist(userId: string, input: ListItemInput) {
  return prisma.watchlistItem.upsert({
    where: { userId_animeId: { userId, animeId: input.animeId } },
    create: { userId, ...input },
    update: { title: input.title, image: input.image, rating: input.rating, type: input.type },
  });
}

export async function removeFromWatchlist(userId: string, animeId: string): Promise<void> {
  const result = await prisma.watchlistItem.deleteMany({ where: { userId, animeId } });
  if (result.count === 0) {
    throw ApiError.notFound("El anime no está en la watchlist");
  }
}
