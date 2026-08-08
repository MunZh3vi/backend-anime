import axios from "axios";
import * as cheerio from "cheerio";
import vm from "node:vm";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { fetchHtml, resolveAbsoluteUrl, HTML_HEADERS } from "../utils/scraperHttp";
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

const DEFAULT_DOMAIN = "jkanime.net";

type LinkVariant = "SUB" | "DUB";

interface LinkRecord {
  server: string;
  token: string;
  url: string;
  quality: string | null;
}

interface VariantLinkRecords {
  SUB: LinkRecord[];
  DUB: LinkRecord[];
}

interface AnimeInfoValues {
  type?: string;
  status?: string;
  totalEpisodes?: number | null;
  emitido?: string;
  genres?: GenreInfo[];
}

interface ParsedAnimeInfo {
  title: string | null;
  titleAlt: string | null;
  description: string | null;
  image: string | null;
  animeId: string | null;
  infoValues: AnimeInfoValues;
}

/**
 * JKAnime no expone una API JSON pública estable para episodios: en la mayoria
 * de los casos hay que raspar el HTML. `fetchJson` replica el helper del
 * original para el fallback AJAX (`/ajax/episodes/:id/1`), devolviendo null
 * en caso de error en vez de lanzar, igual que la fuente.
 */
async function fetchJson(
  url: string,
  options: { headers?: Record<string, string>; method?: string; data?: unknown } = {}
): Promise<unknown> {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios({
      url,
      timeout,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        ...HTML_HEADERS,
        ...(options.headers || {}),
      },
      method: options.method || "GET",
      data: options.data,
    });
    return response.data;
  } catch (error) {
    logger.debug("[JKAnime] Fallo fetchJson", { url, error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * Adaptador sobre `resolveAbsoluteUrl` de scraperHttp (que espera `(base,
 * relative)`) para preservar la ergonomia `(candidate, domain)` que usa el
 * servicio original de JKAnime en todos sus call sites, y validar que el
 * resultado sea una URL absoluta real antes de devolverla.
 */
function toAbsoluteUrl(urlCandidate: unknown, domain: string = DEFAULT_DOMAIN): string | null {
  if (!urlCandidate || typeof urlCandidate !== "string") {
    return null;
  }

  const resolved = resolveAbsoluteUrl(`https://${domain}`, urlCandidate);
  if (!resolved) {
    return null;
  }

  try {
    // eslint-disable-next-line no-new
    new URL(resolved);
    return resolved;
  } catch {
    return null;
  }
}

function normalizeInputUrl(urlCandidate: unknown, domain: string = DEFAULT_DOMAIN): string {
  const normalized = toAbsoluteUrl(urlCandidate, domain);
  if (!normalized) {
    throw ApiError.badRequest("URL invalida");
  }
  return normalized;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function parseEpisodeNumberFromUrl(url: string): number | null {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const number = Number(lastSegment);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

function normalizeToken(value: unknown): string {
  return (value || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeServerName(serverName: unknown, url: string): { name: string; token: string } {
  if (serverName && typeof serverName === "string") {
    const token = normalizeToken(serverName);
    if (token) {
      return { name: serverName.trim(), token };
    }
  }

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return {
      name: host,
      token: normalizeToken(host),
    };
  } catch {
    return { name: "Unknown", token: "unknown" };
  }
}

function pushDeduped(target: LinkRecord[], link: LinkRecord | null): void {
  if (!link || !link.url) {
    return;
  }

  if (target.some((item) => item.url === link.url)) {
    return;
  }

  target.push(link);
}

function buildExcludedTokens(includeMega: boolean, excludeServersRaw: unknown): Set<string> {
  const excluded = new Set<string>();

  const raw = typeof excludeServersRaw === "string" ? excludeServersRaw : "";
  for (const part of raw.split(",")) {
    const token = normalizeToken(part);
    if (token) {
      excluded.add(token);
    }
  }

  if (!includeMega) {
    excluded.add("mega");
  }

  return excluded;
}

function filterLinksByServers(links: LinkRecord[], excludedTokens: Set<string>): LinkRecord[] {
  return links.filter((link) => {
    const token = normalizeToken(link.token || link.server);
    if (!token) {
      return true;
    }

    if (excludedTokens.has(token)) {
      return false;
    }

    if (token.includes("mega") && excludedTokens.has("mega")) {
      return false;
    }

    return true;
  });
}

function sanitizeLinksForResponse(links: LinkRecord[]): VideoLink[] {
  return links.map((link) => {
    const result: VideoLink = {
      server: link.server,
      url: link.url,
    };

    if (link.quality) {
      result.quality = link.quality;
    }

    return result;
  });
}

function extractBalancedSection(text: string, startIndex: number, openChar: string, closeChar: string): string | null {
  let depth = 0;
  let activeQuote = "";
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (activeQuote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === activeQuote) {
        activeQuote = "";
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      activeQuote = character;
      continue;
    }

    if (character === openChar) {
      depth += 1;
    }

    if (character === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

/**
 * Igual que en el original: se evalua el literal de array/objeto embebido en
 * el HTML dentro de un contexto vm aislado (sin globales, timeout 1s) en vez
 * de un `eval()` crudo sobre contenido remoto.
 */
function safeEvaluate(expression: string): unknown {
  try {
    const context = Object.create(null);
    return vm.runInNewContext(expression, context, {
      timeout: 1000,
      displayErrors: false,
    });
  } catch {
    return null;
  }
}

function extractVarLiteral(html: string, varName: string): string | null {
  const marker = `var ${varName}`;
  const startIndex = html.indexOf(marker);
  if (startIndex === -1) {
    return null;
  }

  const equalsIndex = html.indexOf("=", startIndex);
  if (equalsIndex === -1) {
    return null;
  }

  const slice = html.slice(equalsIndex + 1);
  const firstBracketIndex = slice.search(/[[{]/);
  if (firstBracketIndex === -1) {
    return null;
  }

  const openChar = slice[firstBracketIndex];
  const closeChar = openChar === "{" ? "}" : "]";
  return extractBalancedSection(slice, firstBracketIndex, openChar, closeChar);
}

function extractVideoIframeUrls(html: string): string[] {
  const urls: string[] = [];
  const videoPattern = /video\[\d+\]\s*=\s*(['"])([\s\S]*?)\1/g;
  let match: RegExpExecArray | null = null;

  while ((match = videoPattern.exec(html))) {
    const fragment = match[2];
    const srcMatch = fragment.match(/src=['"]([^'"]+)['"]/i);
    if (srcMatch && srcMatch[1]) {
      urls.push(srcMatch[1]);
    }
  }

  return urls;
}

function decodeBase64(value: unknown): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return Buffer.from(value, "base64").toString("utf8").trim();
  } catch {
    return null;
  }
}

function normalizeVariantKey(value: unknown): LinkVariant {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return "SUB";
  }

  if (normalized.includes("sub") || normalized.includes("jp") || normalized.includes("jap")) {
    return "SUB";
  }

  return "DUB";
}

function parseSearchResultsFromHtml(html: string, domain: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  const results: SearchResultItem[] = [];

  $(".anime__item").each((_, element) => {
    const card = $(element);
    const title = card.find(".anime__item__text h5 a").first().text().trim();
    const link = card.find(".anime__item__text h5 a").attr("href") || card.find("a").first().attr("href");

    if (!title || !link) {
      return;
    }

    const image =
      card.find(".anime__item__pic").attr("data-setbg") ||
      card.find("img").attr("data-setbg") ||
      card.find("img").attr("src") ||
      null;

    const status = card.find(".anime__item__text ul li").first().text().trim() || null;
    const type = card.find(".anime__item__text ul li").last().text().trim() || null;

    let slug: string | null = null;
    const absoluteLink = toAbsoluteUrl(link, domain);
    if (absoluteLink) {
      try {
        const parsed = new URL(absoluteLink);
        slug = parsed.pathname.split("/").filter(Boolean)[0] || null;
      } catch {
        slug = null;
      }
    }

    results.push({
      id: null,
      title,
      slug,
      url: toAbsoluteUrl(link, domain),
      image: toAbsoluteUrl(image, domain),
      backdrop: null,
      type,
      score: null,
      status,
      year: null,
    });
  });

  return results;
}

function parseAnimeInfoFromHtml(html: string): ParsedAnimeInfo {
  const $ = cheerio.load(html);
  const info = $(".anime_info");

  const title = info.find("h3").first().text().trim() || null;
  const titleAlt = info.find("span").first().text().trim() || null;
  const description = info.find("p").first().text().trim() || null;
  const image =
    info.find("img").attr("src") || info.find("img").attr("data-setbg") || $(".movpic img").attr("src") || null;

  const infoValues: AnimeInfoValues = {};

  $("li").each((_, element) => {
    const labelSource =
      $(element).find("span").first().text().trim() || $(element).find("div").first().text().trim();
    const label = labelSource.replace(":", "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!label) {
      return;
    }

    const fullText = $(element).text().replace(/\s+/g, " ").trim();

    if (label === "tipo") {
      infoValues.type = fullText.replace(/Tipo:/i, "").trim();
    }

    if (label === "estado") {
      const status = $(element).find(".enemision").text().trim();
      infoValues.status = status || fullText.replace(/Estado:/i, "").trim();
    }

    if (label === "episodios") {
      const raw = fullText.replace(/Episodios:/i, "").trim();
      infoValues.totalEpisodes = parseNumber(raw) || null;
    }

    if (label === "emitido") {
      infoValues.emitido = fullText.replace(/Emitido:/i, "").trim();
    }

    if (label === "generos") {
      const genres: GenreInfo[] = [];
      $(element)
        .find("a")
        .each((_, link) => {
          const name = $(link).text().trim();
          if (!name) {
            return;
          }
          genres.push({
            id: null,
            name,
            slug: name.toLowerCase().replace(/\s+/g, "-"),
            malId: null,
          });
        });
      if (genres.length) {
        infoValues.genres = genres;
      }
    }
  });

  const animeId = $("#guardar-anime").attr("data-anime") || null;

  return {
    title,
    titleAlt,
    description,
    image,
    animeId,
    infoValues,
  };
}

function parseEpisodesFromHtml(html: string, domain: string, slug: string): EpisodeRef[] {
  const $ = cheerio.load(html);
  const episodes: EpisodeRef[] = [];

  $("#episodes-content a, .episodes-content a, .list-group a").each((_, element) => {
    const link = $(element).attr("href");
    if (!link) {
      return;
    }

    const url = toAbsoluteUrl(link, domain);
    if (!url || !/\/\d+\/?$/.test(url)) {
      return;
    }

    const number = parseEpisodeNumberFromUrl(url);
    episodes.push({
      id: null,
      // La regex de arriba ya garantiza que el ultimo segmento sea numerico,
      // asi que `number` practicamente nunca es null aqui; 0 es solo el
      // fallback exigido por el contrato de tipos compartido (EpisodeRef).
      number: number ?? 0,
      title: number ? `Episodio ${number}` : $(element).text().trim(),
      url,
    });
  });

  if (episodes.length > 0) {
    return episodes;
  }

  if (!slug) {
    return episodes;
  }

  const episodeLinks: EpisodeRef[] = [];
  $("a").each((_, element) => {
    const link = $(element).attr("href");
    if (!link) {
      return;
    }

    const url = toAbsoluteUrl(link, domain);
    if (!url || !url.includes(`/${slug}/`)) {
      return;
    }

    const number = parseEpisodeNumberFromUrl(url);
    if (!number) {
      return;
    }

    episodeLinks.push({
      id: null,
      number,
      title: `Episodio ${number}`,
      url,
    });
  });

  return episodeLinks;
}

function parseToken(html: string): string | null {
  const $ = cheerio.load(html);
  const metaToken = $("meta[name='csrf-token']").attr("content");
  if (metaToken) {
    return metaToken.trim();
  }

  const match = html.match(/var\s+token\s*=\s*['"]([^'"]+)['"]/i);
  return match ? match[1] : null;
}

async function fetchEpisodesFromApi(
  animeId: string | null,
  slug: string,
  referer: string,
  token: string | null
): Promise<EpisodeRef[]> {
  if (!animeId) {
    return [];
  }

  const apiUrl = `https://${DEFAULT_DOMAIN}/ajax/episodes/${animeId}/1`;
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
    Referer: referer,
  };

  let data = await fetchJson(apiUrl, { headers, method: "GET" });

  if (!data && token) {
    data = await fetchJson(apiUrl, {
      headers,
      method: "POST",
      data: { _token: token },
    });
  }

  const payload = data as { data?: unknown[] } | null;
  const items: Record<string, unknown>[] = Array.isArray(payload?.data)
    ? (payload!.data as Record<string, unknown>[])
    : [];

  return items
    .map((item): EpisodeRef | null => {
      const number = parseNumber(item.number ?? item.episode);
      if (!number) {
        return null;
      }

      return {
        id: (item.id as string | number | null) ?? null,
        number,
        title: (item.title as string) || `Episodio ${number}`,
        url: `https://${DEFAULT_DOMAIN}/${slug}/${number}/`,
      };
    })
    .filter((item): item is EpisodeRef => Boolean(item));
}

function buildLinkRecord(serverName: unknown, url: string | null, quality: string | null): LinkRecord | null {
  if (!url) {
    return null;
  }

  const server = normalizeServerName(serverName, url);
  return {
    server: server.name,
    token: server.token,
    url,
    quality: quality || null,
  };
}

export async function searchAnime(query: unknown, domainCandidate?: unknown): Promise<ProviderResponse<SearchData>> {
  const cleanQuery = (query || "").toString().trim();
  if (!cleanQuery) {
    throw ApiError.badRequest("Se requiere el parametro q");
  }

  const domain = (domainCandidate || DEFAULT_DOMAIN || "jkanime.net").toString().trim();

  const candidates = [
    `https://${domain}/buscar/${encodeURIComponent(cleanQuery)}`,
    `https://${domain}/buscar?q=${encodeURIComponent(cleanQuery)}`,
  ];

  let bestResults: SearchResultItem[] = [];

  for (const url of candidates) {
    const html = await fetchHtml(url);
    const results = parseSearchResultsFromHtml(html, domain);
    if (results.length > bestResults.length) {
      bestResults = results;
    }

    if (bestResults.length >= 5) {
      break;
    }
  }

  return {
    success: true,
    data: {
      query: cleanQuery,
      results: bestResults,
      count: bestResults.length,
    },
    source: "jkanime",
  };
}

export async function getAnimeInfo(urlCandidate: unknown): Promise<ProviderResponse<AnimeInfoData>> {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const parsed = new URL(normalizedUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);

  const slug = segments[0] || "";
  if (!slug) {
    throw ApiError.badRequest("URL invalida");
  }

  const baseUrl = `https://${DEFAULT_DOMAIN}/${slug}/`;
  const html = await fetchHtml(baseUrl);
  const info = parseAnimeInfoFromHtml(html);

  let episodes = parseEpisodesFromHtml(html, DEFAULT_DOMAIN, slug);

  if (episodes.length === 0) {
    const token = parseToken(html);
    const apiEpisodes = await fetchEpisodesFromApi(info.animeId, slug, baseUrl, token);
    if (apiEpisodes.length > 0) {
      episodes = apiEpisodes;
    }
  }

  // El contrato compartido AnimeInfoData exige totalEpisodes numerico (no
  // nulo); igual que el original, se prefiere el dato scrapeado y se cae al
  // conteo de episodios, con 0 como ultimo recurso en vez de null.
  const totalEpisodes = info.infoValues.totalEpisodes || episodes.length || 0;

  return {
    success: true,
    data: {
      id: info.animeId ? Number(info.animeId) : null,
      title: info.title || null,
      titleJapanese: info.titleAlt || null,
      description: info.description || null,
      image: toAbsoluteUrl(info.image, DEFAULT_DOMAIN),
      backdrop: null,
      status: info.infoValues.status || null,
      type: info.infoValues.type || null,
      year: null,
      startDate: info.infoValues.emitido || null,
      endDate: null,
      score: null,
      votes: null,
      totalEpisodes,
      malId: null,
      trailer: null,
      genres: info.infoValues.genres || [],
      episodes,
    },
    source: "jkanime",
  };
}

export async function getEpisodeLinks(
  urlCandidate: unknown,
  includeMegaRaw?: unknown,
  excludeServersRaw?: unknown
): Promise<ProviderResponse<EpisodeLinksData>> {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const includeMega = String(includeMegaRaw).toLowerCase() === "true";
  const excludedTokens = buildExcludedTokens(includeMega, excludeServersRaw);

  const html = await fetchHtml(normalizedUrl);
  const title = cheerio.load(html)("h1").first().text().trim() || null;

  const streamLinks: VariantLinkRecords = { SUB: [], DUB: [] };
  const downloadLinks: VariantLinkRecords = { SUB: [], DUB: [] };

  // NOTA: JKPlayer usa cifrado propietario con tokens rotativos para las URLs
  // de video reales; el proyecto original documenta que no se logro
  // decodificar. Aqui solo se extraen los enlaces que el HTML expone
  // directamente (servers[] en base64 y los src de video[n]); si el sitio no
  // expone nada usable no hay mas que intentar, no es un bug de esta
  // traduccion.
  const serversLiteral = extractVarLiteral(html, "servers");
  if (serversLiteral) {
    const serversData = safeEvaluate(`(${serversLiteral})`);
    if (Array.isArray(serversData)) {
      const remoteMatch = html.match(/var\s+remote\s*=\s*['"]([^'"]+)['"]/i);
      const remoteBase = remoteMatch ? remoteMatch[1] : null;

      for (const rawEntry of serversData) {
        if (!rawEntry || typeof rawEntry !== "object") {
          continue;
        }
        const entry = rawEntry as Record<string, unknown>;

        const decodedUrl = decodeBase64(entry.remote);
        const variant = normalizeVariantKey(entry.lang);
        const streamLink = buildLinkRecord(entry.server, decodedUrl, (entry.size as string) || null);
        if (streamLink) {
          pushDeduped(streamLinks[variant], streamLink);
        }

        if (remoteBase && entry.slug) {
          const downloadUrl = `${remoteBase.replace(/\/$/, "")}/d/${entry.slug}/`;
          const downloadLink = buildLinkRecord(entry.server, downloadUrl, (entry.size as string) || null);
          if (downloadLink) {
            pushDeduped(downloadLinks[variant], downloadLink);
          }
        }
      }
    } else {
      logger.debug("[JKAnime] Literal 'servers' encontrado pero no evaluo a un array");
    }
  }

  const iframeUrls = extractVideoIframeUrls(html);
  for (const url of iframeUrls) {
    const link = buildLinkRecord("JKPlayer", url, null);
    if (link) {
      pushDeduped(streamLinks.SUB, link);
    }
  }

  const filteredStreamSub = filterLinksByServers(streamLinks.SUB, excludedTokens);
  const filteredStreamDub = filterLinksByServers(streamLinks.DUB, excludedTokens);
  const filteredDownloadSub = filterLinksByServers(downloadLinks.SUB, excludedTokens);
  const filteredDownloadDub = filterLinksByServers(downloadLinks.DUB, excludedTokens);

  return {
    success: true,
    data: {
      id: null,
      episode: parseEpisodeNumberFromUrl(normalizedUrl),
      title: title || `Episodio ${parseEpisodeNumberFromUrl(normalizedUrl) ?? "?"}`,
      season: null,
      variants: {
        SUB: filteredStreamSub.length > 0 || filteredDownloadSub.length > 0 ? 1 : 0,
        DUB: filteredStreamDub.length > 0 || filteredDownloadDub.length > 0 ? 1 : 0,
      },
      publishedAt: null,
      servers: {
        sub: sanitizeLinksForResponse(filteredStreamSub),
        dub: sanitizeLinksForResponse(filteredStreamDub),
      },
      streamLinks: {
        SUB: sanitizeLinksForResponse(filteredStreamSub),
        DUB: sanitizeLinksForResponse(filteredStreamDub),
      },
      downloadLinks: {
        SUB: sanitizeLinksForResponse(filteredDownloadSub),
        DUB: sanitizeLinksForResponse(filteredDownloadDub),
      },
    },
    source: "jkanime",
  };
}
