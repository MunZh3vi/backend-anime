import { prisma } from "../config/prisma";
import { isMatureAnimeUrl } from "./anime.service";

export interface TrendingItem {
  animeId: string;
  title: string;
  image: string | null;
  viewers: number;
  watchCount: number;
}

const DEFAULT_WINDOW_DAYS = 7;

/**
 * Ranking propio armado con el historial de reproducción real de los
 * usuarios (no el orden que trae el catálogo del proveedor). "viewers" es
 * la cantidad de usuarios distintos que vieron algo de ese anime en la
 * ventana de tiempo; desempata por cantidad total de episodios vistos.
 */
export async function getTrending(days = DEFAULT_WINDOW_DAYS, limit = 10, allowMature = false): Promise<TrendingItem[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.watchHistoryEntry.findMany({
    where: { watchedAt: { gte: since } },
    select: { animeId: true, animeTitle: true, image: true, userId: true, watchedAt: true },
    orderBy: { watchedAt: "desc" },
  });

  const byAnime = new Map<string, { title: string; image: string | null; viewers: Set<string>; watchCount: number }>();
  for (const row of rows) {
    if (!allowMature && isMatureAnimeUrl(row.animeId)) continue;

    let entry = byAnime.get(row.animeId);
    if (!entry) {
      entry = { title: row.animeTitle, image: row.image, viewers: new Set(), watchCount: 0 };
      byAnime.set(row.animeId, entry);
    }
    entry.viewers.add(row.userId);
    entry.watchCount += 1;
  }

  return Array.from(byAnime.entries())
    .map(([animeId, entry]) => ({
      animeId,
      title: entry.title,
      image: entry.image,
      viewers: entry.viewers.size,
      watchCount: entry.watchCount,
    }))
    .sort((a, b) => b.viewers - a.viewers || b.watchCount - a.watchCount)
    .slice(0, limit);
}
