import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import type { ListItemInput } from "../validators/list.validators";

export function listFavorites(userId: string) {
  return prisma.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function addFavorite(userId: string, input: ListItemInput) {
  return prisma.favorite.upsert({
    where: { userId_animeId: { userId, animeId: input.animeId } },
    create: { userId, ...input },
    update: { title: input.title, image: input.image, rating: input.rating, type: input.type },
  });
}

export async function removeFavorite(userId: string, animeId: string): Promise<void> {
  const result = await prisma.favorite.deleteMany({ where: { userId, animeId } });
  if (result.count === 0) {
    throw ApiError.notFound("El anime no está en favoritos");
  }
}
