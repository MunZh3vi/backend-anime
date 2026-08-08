import { Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/response";
import { cacheWrap } from "../cache/cacheManager";
import { CACHE_TTL } from "../config/constants";
import * as animeService from "../services/anime.service";
import * as animeflvService from "../services/animeflv.service";
import * as animeav1Service from "../services/animeav1.service";
import * as jkanimeService from "../services/jkanime.service";
import * as tioanimeService from "../services/tioanime.service";
import * as monoschinosService from "../services/monoschinos.service";
import * as hentailaService from "../services/hentaila.service";
import { resolveEmbedUrl } from "../utils/resolvers/resolvers";

type CatalogCapable = { getCatalog?: (page?: unknown, genre?: unknown) => Promise<unknown> };

// Record<string, unknown> evita el chequeo de "weak type" de TS, ya que la
// mayoría de estos módulos no exponen getCatalog (JKAnime/TioAnime/MonosChinos/
// HentaiLA no lo soportan según el README de origen) y por eso no comparten
// estructuralmente ninguna propiedad con CatalogCapable.
const CATALOG_PROVIDERS: Record<string, unknown> = {
  animeflv: animeflvService,
  jkanime: jkanimeService,
  tioanime: tioanimeService,
  monoschinos: monoschinosService,
  hentaila: hentailaService,
  animeav1: animeav1Service,
};

const STATUS_TEST_QUERY = "naruto";

// Naruto ep. 1 es un fixture estable (siempre existe, numeración fija) para
// verificar si un proveedor está devolviendo servidores de video reales o no.
const STATUS_EPISODE_TEST_URLS: Record<string, string> = {
  animeflv: "https://animeflv.net/ver/naruto-1",
  animeav1: "https://animeav1.com/media/naruto/1",
};

interface ProviderStatusCheck {
  ok: boolean;
  responseTimeMs: number;
  error: string | null;
}

interface ProviderStatusResult {
  provider: string;
  label: string;
  search: ProviderStatusCheck & { resultCount: number };
  episodes: (ProviderStatusCheck & { hasVideoLinks: boolean }) | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkProviderStatus(providerId: string, label: string): Promise<ProviderStatusResult> {
  const searchStart = Date.now();
  let search: ProviderStatusResult["search"];
  try {
    const result = await animeService.searchAnime(STATUS_TEST_QUERY, providerId);
    search = { ok: true, resultCount: result.data.results.length, responseTimeMs: Date.now() - searchStart, error: null };
  } catch (err) {
    search = { ok: false, resultCount: 0, responseTimeMs: Date.now() - searchStart, error: errorMessage(err) };
  }

  let episodes: ProviderStatusResult["episodes"] = null;
  const episodeUrl = STATUS_EPISODE_TEST_URLS[providerId];
  if (episodeUrl) {
    const epStart = Date.now();
    try {
      const result = await animeService.getEpisodeLinks(episodeUrl);
      const hasVideoLinks = result.data.streamLinks.SUB.length > 0 || result.data.streamLinks.DUB.length > 0;
      episodes = { ok: true, hasVideoLinks, responseTimeMs: Date.now() - epStart, error: null };
    } catch (err) {
      episodes = { ok: false, hasVideoLinks: false, responseTimeMs: Date.now() - epStart, error: errorMessage(err) };
    }
  }

  return { provider: providerId, label, search, episodes };
}

export async function status(_req: Request, res: Response) {
  const providers = animeService.listProviders();

  const result = await cacheWrap("anime:status", 60, async () => ({
    checkedAt: new Date().toISOString(),
    providers: await Promise.all(providers.map((p) => checkProviderStatus(p.id, p.label))),
  }));

  sendSuccess(res, result);
}

export async function search(req: Request, res: Response) {
  const { q, domain } = req.query;
  const result = await animeService.searchAnime(q, domain);
  res.status(200).json(result);
}

export async function info(req: Request, res: Response) {
  if (!req.query.url) throw ApiError.badRequest("Se requiere el parametro url");
  const result = await cacheWrap(`anime:info:${req.query.url}`, CACHE_TTL.CATALOG, () =>
    animeService.getAnimeInfo(req.query.url)
  );
  res.status(200).json(result);
}

export async function episode(req: Request, res: Response) {
  if (!req.query.url) throw ApiError.badRequest("Se requiere el parametro url");
  const result = await cacheWrap(
    `anime:episode:${req.query.url}:${req.query.includeMega}:${req.query.excludeServers}`,
    CACHE_TTL.EPISODE,
    () => animeService.getEpisodeLinks(req.query.url, req.query.includeMega, req.query.excludeServers)
  );
  res.status(200).json(result);
}

export async function catalog(req: Request, res: Response) {
  const provider = String(req.query.provider || req.query.domain || "animeav1");
  let service = CATALOG_PROVIDERS[provider] as CatalogCapable | undefined;

  if (!service || typeof service.getCatalog !== "function") {
    service = CATALOG_PROVIDERS.animeav1 as CatalogCapable;
  }

  const result = await cacheWrap(`anime:catalog:${provider}:${req.query.page}:${req.query.genre}`, CACHE_TTL.CATALOG, () =>
    service!.getCatalog!(req.query.page, req.query.genre)
  );

  const data = (result as { data?: { results?: Array<Record<string, unknown>> } }).data;
  if (data && Array.isArray(data.results)) {
    for (const item of data.results) {
      if (item.url) item.slug = item.url;
      item.provider = provider;
    }
  }

  res.status(200).json(result);
}

interface ResolvedStream {
  success: true;
  server: string;
  mediaType: "hls" | "mp4";
  streamUrl: string;
  resolvedFrom: string;
}

function detectServerLabel(url: string): string {
  if (url.includes("voe")) return "voe";
  if (url.includes("tape")) return "streamtape";
  if (url.includes("wish") || url.includes("playnix") || url.includes("medix") || url.includes("awish")) return "streamwish";
  if (url.includes("vidhide")) return "vidhide";
  if (url.includes("dood")) return "doodstream";
  return "unknown";
}

export async function resolve(req: Request, res: Response) {
  let urls: string[] = [];

  if (req.query.urls) {
    try {
      const parsed = JSON.parse(String(req.query.urls));
      urls = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      urls = [String(req.query.urls)];
    }
  } else if (req.query.url) {
    urls = [String(req.query.url)];
  }

  if (urls.length === 0) throw ApiError.badRequest("Se requiere el parametro url o urls");

  const resolvePromises = urls.map(async (url): Promise<ResolvedStream> => {
    const directUrl = await resolveEmbedUrl(url).catch(() => null);
    if (directUrl && directUrl !== url) {
      return {
        success: true,
        server: detectServerLabel(url),
        mediaType: directUrl.includes(".m3u8") ? "hls" : "mp4",
        streamUrl: directUrl,
        resolvedFrom: url,
      };
    }
    throw new Error("No se pudo resolver");
  });

  try {
    const fastestResult = await Promise.any(resolvePromises);
    res.status(200).json(fastestResult);
  } catch {
    throw ApiError.notFound("No se pudo obtener el enlace de streaming directo en ningún servidor");
  }
}
