import cron from "node-cron";
import { logger } from "../utils/logger";
import { cleanupExpiredRefreshTokens } from "../services/tokenCleanup.service";
import { checkNewEpisodesForWatchlists } from "../services/episodeNotification.service";

/**
 * Arranca los jobs recurrentes del proceso. Se llama una sola vez desde
 * server.ts al levantar el servidor (no en tests/typecheck).
 */
export function startCronJobs(): void {
  // Todos los días a las 03:00: borra refresh tokens vencidos/revocados.
  cron.schedule("0 3 * * *", async () => {
    try {
      await cleanupExpiredRefreshTokens();
    } catch (err) {
      logger.error("[cron] Falló la limpieza de refresh tokens", { error: err });
    }
  });

  // Cada hora: revisa si algún anime en watchlist sumó episodios nuevos.
  cron.schedule("0 * * * *", async () => {
    try {
      await checkNewEpisodesForWatchlists();
    } catch (err) {
      logger.error("[cron] Falló la revisión de episodios nuevos", { error: err });
    }
  });

  logger.info("[cron] Jobs programados: limpieza de tokens (diaria), episodios nuevos (cada hora)");
}
