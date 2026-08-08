import NodeCache from "node-cache";
import { logger } from "../utils/logger";

// checkperiod más corto que el TTL típico para liberar memoria de claves expiradas puntualmente.
const store = new NodeCache({ stdTTL: 0, checkperiod: 120, useClones: false });

/**
 * Patrón cache-aside: si la clave existe en caché la devuelve, si no ejecuta
 * `fetcher`, guarda el resultado con el TTL indicado (segundos) y lo devuelve.
 * Los errores de `fetcher` nunca se cachean.
 */
export async function cacheWrap<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = store.get<T>(key);
  if (cached !== undefined) {
    logger.debug(`cache hit: ${key}`);
    return cached;
  }

  logger.debug(`cache miss: ${key}`);
  const fresh = await fetcher();
  store.set(key, fresh, ttlSeconds);
  return fresh;
}

export function cacheInvalidate(key: string) {
  store.del(key);
}

export function cacheFlushAll() {
  store.flushAll();
}
