import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";

/**
 * Borra filas de refresh_tokens que ya no sirven para nada: vencidas o
 * revocadas (rotación/logout). Sin esto la tabla crece para siempre.
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] },
  });

  if (result.count > 0) {
    logger.info(`[token-cleanup] ${result.count} refresh tokens vencidos/revocados eliminados`);
  }

  return result.count;
}
