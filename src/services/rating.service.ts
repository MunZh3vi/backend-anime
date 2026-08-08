import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";

export interface RatingSummary {
  animeId: string;
  average: number | null;
  count: number;
  myScore: number | null;
}

export async function getRatingSummary(animeId: string, viewerUserId?: string): Promise<RatingSummary> {
  const [aggregate, mine] = await Promise.all([
    prisma.rating.aggregate({ where: { animeId }, _avg: { score: true }, _count: true }),
    viewerUserId ? prisma.rating.findUnique({ where: { userId_animeId: { userId: viewerUserId, animeId } } }) : null,
  ]);

  return {
    animeId,
    average: aggregate._avg.score !== null ? Math.round(aggregate._avg.score * 10) / 10 : null,
    count: aggregate._count,
    myScore: mine?.score ?? null,
  };
}

export async function upsertRating(userId: string, animeId: string, score: number): Promise<RatingSummary> {
  await prisma.rating.upsert({
    where: { userId_animeId: { userId, animeId } },
    create: { userId, animeId, score },
    update: { score },
  });

  return getRatingSummary(animeId, userId);
}

export async function removeRating(userId: string, animeId: string): Promise<void> {
  const result = await prisma.rating.deleteMany({ where: { userId, animeId } });
  if (result.count === 0) {
    throw ApiError.notFound("No calificaste este anime");
  }
}
