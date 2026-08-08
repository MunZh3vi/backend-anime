import { env } from "./env";

export const CACHE_TTL = {
  CATALOG: env.cacheTtlCatalog,
  EPISODE: env.cacheTtlEpisode,
};

// User-Agent "de navegador" para reducir bloqueos por parte de las fuentes de scraping.
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
