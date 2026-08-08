import axios from "axios";
import * as cheerio from "cheerio";
import { URL } from "node:url";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { fetchHtml, fetchHtmlWithHeaders, HTML_HEADERS } from "../utils/scraperHttp";
import {
  AnimeInfoData,
  EpisodeLinksData,
  EpisodeRef,
  ProviderResponse,
  SearchData,
  SearchResultItem,
  VideoLink,
} from "../types/provider.types";

const DEFAULT_DOMAIN = "monoschinos2.com";

interface AjaxPaginationData {
  paginate_url?: string;
  perpage?: number;
  eps?: unknown[];
}

interface AjaxEpisodePage {
  caps?: Array<{ episodio?: unknown; url?: string }>;
}

function parseEpisodeNumberFromUrl(url: string): number | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    // formato: nombre-anime-episodio-1
    const match = lastSegment.match(/-episodio-(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function slugFromUrl(url: unknown): string | null {
  try {
    const urlStr = String(url);
    const segments = new URL(urlStr).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (urlStr.includes("/anime/")) {
      return lastSegment;
    }
    return lastSegment.replace(/-episodio-\d+$/, "");
  } catch {
    return null;
  }
}

// Public API

export async function searchAnime(query: unknown, domainCandidate?: unknown): Promise<ProviderResponse<SearchData>> {
  const cleanQuery = String(query ?? "").trim();
  if (!cleanQuery) {
    throw ApiError.badRequest("Se requiere el parametro q");
  }

  const domain = String(domainCandidate || DEFAULT_DOMAIN).trim();
  const searchUrl = `https://${domain}/buscar?q=${encodeURIComponent(cleanQuery)}`;
  const html = await fetchHtml(searchUrl);

  const $ = cheerio.load(html);
  const results: SearchResultItem[] = [];

  $("a[href*='/anime/']").each((_, element) => {
    const link = $(element).attr("href");
    const title = $(element).find("h3.title_cap, h3").first().text().trim() || $(element).text().trim();
    const image = $(element).find("img").attr("data-src") || $(element).find("img").attr("src");
    const yearStr = $(element).find("span.text-muted").first().text().trim();

    if (!link || !title) return;
    if ($(element).find("img").length === 0) return;

    const slug = slugFromUrl(link);
    const year = yearStr && !isNaN(Number(yearStr)) ? Number(yearStr) : null;

    results.push({
      id: null,
      title,
      slug,
      url: link.startsWith("http") ? link : `https://${domain}${link}`,
      image: image ? (image.startsWith("http") ? image : `https://${domain}${image}`) : null,
      backdrop: null,
      type: "Anime",
      score: null,
      status: null,
      year: year !== null ? String(year) : null,
    });
  });

  return {
    success: true,
    data: { query: cleanQuery, results, count: results.length },
    source: "monoschinos",
  };
}

export async function getAnimeInfo(urlCandidate: unknown): Promise<ProviderResponse<AnimeInfoData>> {
  const slug = slugFromUrl(urlCandidate);
  if (!slug) throw ApiError.badRequest("URL invalida");

  const urlStr = String(urlCandidate);
  let domain = DEFAULT_DOMAIN;
  try {
    domain = new URL(urlStr).host || DEFAULT_DOMAIN;
  } catch {
    domain = DEFAULT_DOMAIN;
  }

  const animeUrl = `https://${domain}/anime/${slug}`;
  const { html, headers } = await fetchHtmlWithHeaders(animeUrl);

  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim();
  const description = $("p.text-sm.text-gray-400, .synopsis").first().text().trim() || null;
  const image = $("img.lazy").attr("data-src") || $("img").first().attr("src");

  const episodes: EpisodeRef[] = [];
  let epsFoundFromAjax = false;

  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/i);
  const axMatch = html.match(/(https?:\/\/[^\s"'<>]+\/ajax_pagination\/\d+)/i);

  if (csrfMatch && axMatch) {
    try {
      const csrfToken = csrfMatch[1];
      const axUrl = axMatch[1];
      const setCookie = headers["set-cookie"];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : "";
      const reqHeaders = { ...HTML_HEADERS, "X-CSRF-TOKEN": csrfToken, Cookie: cookieStr };

      const axResponse = await axios.post<AjaxPaginationData>(axUrl, null, { headers: reqHeaders });
      const pData = axResponse.data;

      if (pData && pData.paginate_url && Array.isArray(pData.eps)) {
        epsFoundFromAjax = true;
        const totalEps = pData.eps.length;
        const perPage = pData.perpage || 50;
        const totalPages = Math.ceil(totalEps / perPage);

        for (let page = 1; page <= totalPages; page++) {
          const epsUrl = `${pData.paginate_url}?p=${page}`;
          const epsPage = await axios.post<AjaxEpisodePage>(epsUrl, null, { headers: reqHeaders });
          if (epsPage.data && Array.isArray(epsPage.data.caps)) {
            for (const cap of epsPage.data.caps) {
              const number = Number(cap.episodio);
              if (cap.url && number) {
                episodes.push({
                  id: null,
                  number,
                  title: `Episodio ${number}`,
                  url: cap.url,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      // Si falla, ignoramos y usamos fallback (html directo)
      logger.debug("monoschinos: fallo la paginacion via ajax, usando fallback html", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fallback si no se encontro paginacion
  if (!epsFoundFromAjax) {
    $("a[href*='/ver/']").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const fullUrl = href.startsWith("http") ? href : `https://${domain}${href}`;
      const number = parseEpisodeNumberFromUrl(fullUrl);
      if (number) {
        episodes.push({
          id: null,
          number,
          title: `Episodio ${number}`,
          url: fullUrl,
        });
      }
    });
  }

  const seen = new Set<number>();
  const sortedEpisodes = episodes
    .filter((ep) => {
      const k = ep.number;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.number - b.number);

  return {
    success: true,
    data: {
      id: null,
      title,
      titleJapanese: null,
      description,
      image: image ? (image.startsWith("http") ? image : `https://${domain}${image}`) : null,
      backdrop: null,
      status: null,
      type: "Anime",
      year: null,
      startDate: null,
      endDate: null,
      score: null,
      votes: null,
      totalEpisodes: sortedEpisodes.length,
      malId: null,
      trailer: null,
      genres: [],
      episodes: sortedEpisodes,
    },
    source: "monoschinos",
  };
}

export async function getEpisodeLinks(
  urlCandidate: unknown,
  includeMegaRaw?: unknown,
  excludeServersRaw?: unknown
): Promise<ProviderResponse<EpisodeLinksData>> {
  const urlStr = String(urlCandidate ?? "");
  const slug = slugFromUrl(urlStr);
  const episodeNumber = parseEpisodeNumberFromUrl(urlStr);

  if (!slug || !episodeNumber) {
    throw ApiError.badRequest("URL invalida - no se pudo extraer slug y numero");
  }

  const html = await fetchHtml(urlStr);
  const $ = cheerio.load(html);

  const includeMega = String(includeMegaRaw).toLowerCase() === "true";
  const streamLinks: { SUB: VideoLink[]; DUB: VideoLink[] } = { SUB: [], DUB: [] };
  const excludeList = String(excludeServersRaw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  $(".play-video").each((_, el) => {
    const serverName = $(el).text().trim().toLowerCase();
    const dataPlayer = $(el).attr("data-player");
    if (!dataPlayer) return;

    if (!includeMega && serverName.includes("mega")) {
      return;
    }

    if (excludeList.some((ex) => serverName.includes(ex))) {
      return;
    }

    try {
      const url = Buffer.from(dataPlayer, "base64").toString("utf8");
      if (url.startsWith("http")) {
        streamLinks.SUB.push({ server: serverName, url });
      }
    } catch (error) {
      logger.debug("monoschinos: fallo al decodificar data-player en base64", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const episodeTitle = $("h1").first().text().trim() || `Episodio ${episodeNumber}`;

  return {
    success: true,
    data: {
      id: null,
      episode: episodeNumber,
      title: episodeTitle,
      season: null,
      variants: {
        SUB: streamLinks.SUB.length > 0 ? 1 : 0,
        DUB: 0,
      },
      publishedAt: null,
      servers: {
        sub: streamLinks.SUB,
        dub: [],
      },
      streamLinks: {
        SUB: streamLinks.SUB,
        DUB: [],
      },
      downloadLinks: {
        SUB: [],
        DUB: [],
      },
    },
    source: "monoschinos",
  };
}
