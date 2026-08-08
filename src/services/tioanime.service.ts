import * as cheerio from "cheerio";
import { URL } from "node:url";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { fetchHtml } from "../utils/scraperHttp";
import {
  AnimeInfoData,
  EpisodeLinksData,
  EpisodeRef,
  GenreInfo,
  ProviderResponse,
  SearchData,
  SearchResultItem,
  VideoLink,
} from "../types/provider.types";

const DEFAULT_DOMAIN = "tioanime.com";

type VariantKey = "SUB" | "DUB";

interface ParsedVideoEntry {
  server: string;
  url: string;
}

type ParsedVideoSources = Record<VariantKey, ParsedVideoEntry[]>;

interface ParsedEpisodeStub {
  id: string | number | null;
  number: number;
}

interface ParsedAnimeInfo {
  title: string | null;
  description: string | null;
  genres: GenreInfo[];
  type: string | null;
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeVariantKey(value: unknown): VariantKey {
  const normalized = normalizeToken(value);
  if (!normalized) return "SUB";
  if (normalized.includes("sub") || normalized.includes("jap") || normalized.includes("jp")) return "SUB";
  return "DUB";
}

function parseEpisodeNumberFromUrl(url: string): number | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const match = lastSegment.match(/(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function slugFromUrl(url: unknown): string | null {
  try {
    const segments = new URL(String(url)).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    return lastSegment.replace(/-\d+$/, "");
  } catch {
    return null;
  }
}

function parseVideoSources(html: string): ParsedVideoSources | null {
  const match = html.match(/videos\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return null;

  try {
    const jsonStr = match[1].replace(/\\\//g, "/").replace(/\\"/g, '"');
    const raw: unknown = JSON.parse(jsonStr);

    if (!Array.isArray(raw)) return null;

    const result: ParsedVideoSources = { SUB: [], DUB: [] };

    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const serverName = entry[0] || "Unknown";
      const url = entry[1] || null;
      if (!url) continue;

      result.SUB.push({ server: serverName, url });
    }

    return result;
  } catch (error) {
    logger.debug("tioanime: fallo al parsear videos embebidos", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function parseEpisodeListFromHtml(html: string): ParsedEpisodeStub[] | null {
  const match = html.match(/episodes\s*=\s*(\[[^\]]*\])/);
  if (!match) return null;

  try {
    const raw: unknown = JSON.parse(match[1]);
    if (!Array.isArray(raw)) return null;

    return raw
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      .map((n) => ({ id: null, number: n }))
      .sort((a, b) => a.number - b.number);
  } catch (error) {
    logger.debug("tioanime: fallo al parsear lista de episodios embebida", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function parseAnimeInfoFromHtml(html: string): ParsedAnimeInfo {
  const $ = cheerio.load(html);

  const title = $("h1.title").first().text().trim() || $("h1").first().text().trim() || null;
  const description =
    $("p.sinopsis").first().text().trim() ||
    $(".description").first().text().trim() ||
    $("meta[name='description']").attr("content") ||
    null;

  if (description && description.startsWith("ver online")) {
    return { title, description: null, genres: [], type: null };
  }

  const genres: GenreInfo[] = [];
  $(".genres span a, a[href*='genero']").each((_, el) => {
    const name = $(el).text().trim();
    if (name) {
      genres.push({
        id: null,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        malId: null,
      });
    }
  });

  const typeEl = $(".anime-type-peli, .anime-type-serie, .anime-type-ova, .type").first();
  const type = typeEl.text().trim() || null;

  return { title, description, genres, type };
}

function buildLinkRecord(serverName: unknown, url: string | null, quality: string | null): VideoLink | null {
  if (!url) return null;
  return { server: (serverName as string) || "Unknown", url, quality: quality || null };
}

// Public API

export async function searchAnime(query: unknown, domainCandidate?: unknown): Promise<ProviderResponse<SearchData>> {
  const cleanQuery = String(query ?? "").trim();
  if (!cleanQuery) {
    throw ApiError.badRequest("Se requiere el parametro q");
  }

  const domain = String(domainCandidate || DEFAULT_DOMAIN).trim();
  const searchUrl = `https://${domain}/directorio?search=${encodeURIComponent(cleanQuery)}`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results: SearchResultItem[] = [];

  $("article.anime").each((_, element) => {
    const card = $(element);
    const link = card.find("a[href^='/anime/']").first().attr("href");
    const title = card.find("h3.title").first().text().trim();
    const image = card.find("img").first().attr("src");

    if (!link || !title) return;

    const slug = link.replace("/anime/", "");
    const typeEl = card.find(".anime-type-peli, .anime-type-serie, .anime-type-ova").first();
    const type = typeEl.text().trim() || null;

    results.push({
      id: null,
      title,
      slug,
      url: `https://${domain}${link}`,
      image: image ? `https://${domain}${image}` : null,
      backdrop: null,
      type: type || "Anime",
      score: null,
      status: null,
      year: null,
    });
  });

  return {
    success: true,
    data: { query: cleanQuery, results, count: results.length },
    source: "tioanime",
  };
}

export async function getAnimeInfo(urlCandidate: unknown): Promise<ProviderResponse<AnimeInfoData>> {
  const slug = slugFromUrl(urlCandidate);
  if (!slug) throw ApiError.badRequest("URL invalida");

  const animeUrl = `https://${DEFAULT_DOMAIN}/anime/${slug}`;
  const html = await fetchHtml(animeUrl);

  const info = parseAnimeInfoFromHtml(html);

  // Intentar obtener los episodios desde la variable JS embebida
  let episodesList = parseEpisodeListFromHtml(html);

  // Si no está en el JS, intentar scrapearlos desde los enlaces
  if (!episodesList || episodesList.length === 0) {
    const $ = cheerio.load(html);
    episodesList = [];
    $("a[href*='/ver/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const number = parseEpisodeNumberFromUrl(`https://${DEFAULT_DOMAIN}${href}`);
      if (number) {
        episodesList!.push({ id: null, number });
      }
    });
    // Deduplicar
    const seen = new Set<number>();
    episodesList = episodesList.filter((e) => {
      const k = e.number;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const episodes: EpisodeRef[] = (episodesList || [])
    .filter((ep) => ep && ep.number)
    .map((ep) => ({
      id: ep.id || null,
      number: ep.number,
      title: `Episodio ${ep.number}`,
      url: `https://${DEFAULT_DOMAIN}/ver/${slug}-${ep.number}`,
    }));

  return {
    success: true,
    data: {
      id: null,
      title: info.title,
      titleJapanese: null,
      description: info.description,
      image: null,
      backdrop: null,
      status: null,
      type: info.type,
      year: null,
      startDate: null,
      endDate: null,
      score: null,
      votes: null,
      totalEpisodes: episodes.length,
      malId: null,
      trailer: null,
      genres: info.genres || [],
      episodes,
    },
    source: "tioanime",
  };
}

export async function getEpisodeLinks(urlCandidate: unknown): Promise<ProviderResponse<EpisodeLinksData>> {
  const urlStr = String(urlCandidate ?? "");
  const slug = slugFromUrl(urlStr);
  const episodeNumber = parseEpisodeNumberFromUrl(urlStr);

  if (!slug || !episodeNumber) {
    throw ApiError.badRequest("URL invalida - no se pudo extraer slug y numero");
  }

  const episodeUrl = `https://${DEFAULT_DOMAIN}/ver/${slug}-${episodeNumber}`;
  const html = await fetchHtml(episodeUrl);

  const videoSources = parseVideoSources(html);

  const streamLinks: Record<VariantKey, VideoLink[]> = { SUB: [], DUB: [] };
  const downloadLinks: Record<VariantKey, VideoLink[]> = { SUB: [], DUB: [] };

  if (videoSources) {
    for (const [variantKey, entries] of Object.entries(videoSources) as Array<[string, ParsedVideoEntry[]]>) {
      for (const entry of entries) {
        const link = buildLinkRecord(entry.server, entry.url, null);
        if (link) {
          const key = normalizeVariantKey(variantKey);
          streamLinks[key].push(link);
        }
      }
    }
  }

  const episodeTitle = cheerio.load(html)("h1.title, h1").first().text().trim() || `Episodio ${episodeNumber}`;

  return {
    success: true,
    data: {
      id: null,
      episode: episodeNumber,
      title: episodeTitle,
      season: null,
      variants: {
        SUB: streamLinks.SUB.length > 0 || downloadLinks.SUB.length > 0 ? 1 : 0,
        DUB: streamLinks.DUB.length > 0 || downloadLinks.DUB.length > 0 ? 1 : 0,
      },
      publishedAt: null,
      servers: {
        sub: streamLinks.SUB.map((l) => ({ server: l.server, url: l.url })),
        dub: streamLinks.DUB.map((l) => ({ server: l.server, url: l.url })),
      },
      streamLinks: {
        SUB: streamLinks.SUB.map((l) => ({ server: l.server, url: l.url })),
        DUB: streamLinks.DUB.map((l) => ({ server: l.server, url: l.url })),
      },
      downloadLinks: {
        SUB: [],
        DUB: [],
      },
    },
    source: "tioanime",
  };
}
