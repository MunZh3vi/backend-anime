import { prisma } from "../config/prisma";
import * as animeService from "../services/anime.service";
import { createNotification } from "./notification.service";
import { logger } from "../utils/logger";

/**
 * Recorre los animes distintos que alguien tiene en su watchlist, revisa el
 * conteo de episodios actual contra el último visto (AnimeEpisodeTracker) y
 * notifica a todos los que lo tienen en watchlist cuando sube. Se pasa
 * allowMature:true porque el chequeo es interno (ya está en la watchlist de
 * alguien, no hay nada nuevo que "exponer") — el gating de +18 vive en las
 * rutas HTTP, no acá.
 */
export async function checkNewEpisodesForWatchlists(): Promise<void> {
  const distinctAnime = await prisma.watchlistItem.findMany({
    distinct: ["animeId"],
    select: { animeId: true, title: true },
  });

  for (const { animeId, title } of distinctAnime) {
    try {
      const info = await animeService.getAnimeInfo(animeId, true);
      const totalEpisodes = info.data.totalEpisodes;
      if (!Number.isFinite(totalEpisodes) || totalEpisodes <= 0) continue;

      const tracker = await prisma.animeEpisodeTracker.findUnique({ where: { animeId } });

      if (!tracker) {
        // Primera vez que se ve este anime: solo fija la base, no notifica
        // retroactivamente por episodios que ya existían antes de trackearlo.
        await prisma.animeEpisodeTracker.create({ data: { animeId, lastEpisodeCount: totalEpisodes } });
        continue;
      }

      if (totalEpisodes > tracker.lastEpisodeCount) {
        const watchers = await prisma.watchlistItem.findMany({ where: { animeId }, select: { userId: true } });

        await Promise.all(
          watchers.map((w) =>
            createNotification(
              w.userId,
              "NEW_EPISODE",
              `Nuevo episodio de ${title}`,
              `${title} ya tiene ${totalEpisodes} episodios disponibles`,
              { animeId, totalEpisodes }
            )
          )
        );

        await prisma.animeEpisodeTracker.update({ where: { animeId }, data: { lastEpisodeCount: totalEpisodes } });
        logger.info(`[episode-notification] ${title}: ${tracker.lastEpisodeCount} -> ${totalEpisodes}, ${watchers.length} notificados`);
      }
    } catch (err) {
      // Un anime con URL rota o proveedor caído no debe frenar el resto del recorrido.
      logger.warn(`[episode-notification] Error revisando animeId=${animeId}`, { error: err });
    }
  }
}
