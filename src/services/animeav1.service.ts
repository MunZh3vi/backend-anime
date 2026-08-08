import axios from "axios";
import * as cheerio from "cheerio";
import vm from "node:vm";
import { ApiError } from "../utils/ApiError";
import {
  AnimeInfoData,
  CatalogData,
  EpisodeLinksData,
  EpisodeRef,
  GenreInfo,
  ProviderResponse,
  SearchData,
  SearchResultItem,
  VariantLinks,
  VideoLink,
} from "../types/provider.types";

const DEFAULT_DOMAIN = process.env.DEFAULT_ANIME_DOMAIN || "animeav1.com";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

type Json = unknown;
type JsonObject = Record<string, unknown>;

const SERVER_PATTERNS = [
  { token: "pdrain", name: "PDrain", test: /(pixeldrain|pdrain)/i },
  { token: "hls", name: "HLS", test: /(hls|m3u8|zilla|player\.)/i },
  { token: "upnshare", name: "UPNShare", test: /(upnshare|uns\.bio)/i },
  { token: "mega", name: "Mega", test: /(mega\.nz|mega)/i },
  { token: "mp4upload", name: "MP4Upload", test: /(mp4upload)/i },
  { token: "1fichier", name: "1Fichier", test: /(1fichier)/i },
  { token: "fembed", name: "Fembed", test: /(fembed|femax20)/i },
];

const VIDEO_URL_REGEX =
  /https?:\/\/(?:www\.)?(?:pixeldrain\.com|mega\.nz|mp4upload\.com|1fichier\.com|player\.[^\s"'<>]+|[^\s"'<>]*zilla[^\s"'<>]*|[^\s"'<>]*uns\.bio[^\s"'<>]*)[^\s"'<>]*/gi;

async function fetchHtml(url: string): Promise<string> {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.get<string>(url, {
      timeout,
      headers: HTTP_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(500, "No se pudo obtener contenido desde AnimeAV1", message);
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walk(value: unknown, visitor: (node: unknown) => void, seen = new Set<unknown>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;

  seen.add(value);
  visitor(value);

  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor, seen);
    return;
  }

  for (const child of Object.values(value as JsonObject)) walk(child, visitor, seen);
}

function collectValuesByKey(root: unknown, keyName: string): unknown[] {
  const values: unknown[] = [];
  walk(root, (node) => {
    if (!isObject(node)) return;
    if (Object.prototype.hasOwnProperty.call(node, keyName)) values.push(node[keyName]);
  });
  return values;
}

function collectArrays(root: unknown): unknown[][] {
  const arrays: unknown[][] = [];
  walk(root, (node) => {
    if (Array.isArray(node)) arrays.push(node);
  });
  return arrays;
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
      if (character === activeQuote) activeQuote = "";
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      activeQuote = character;
      continue;
    }

    if (character === openChar) depth += 1;

    if (character === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }

  return null;
}

function safeEvaluate(expression: string): unknown {
  try {
    return vm.runInNewContext(expression, Object.create(null), { timeout: 1000, displayErrors: false });
  } catch {
    return null;
  }
}

/**
 * AnimeAV1 es una SPA SvelteKit: el catálogo/detalle real viaja como JSON de
 * hidratación embebido en un <script> (`__sveltekit_...`), no en el markup.
 * Leer ese payload evita depender de Puppeteer para las páginas principales.
 */
function extractSvelteData(html: string): unknown[] | null {
  const $ = cheerio.load(html);
  const scripts = $("script")
    .map((_, element) => $(element).html() || "")
    .get();

  for (const scriptContent of scripts) {
    if (!scriptContent.includes("__sveltekit_") || !scriptContent.includes("data:")) continue;

    let pointer = scriptContent.indexOf("__sveltekit_");
    while (pointer !== -1) {
      const equalsPosition = scriptContent.indexOf("=", pointer);
      if (equalsPosition === -1) break;

      const objectStart = scriptContent.indexOf("{", equalsPosition);
      if (objectStart === -1) break;

      const objectLiteral = extractBalancedSection(scriptContent, objectStart, "{", "}");
      if (objectLiteral) {
        const payload = safeEvaluate(`(${objectLiteral})`) as { data?: unknown[] } | null;
        if (payload && Array.isArray(payload.data)) return payload.data;
      }

      pointer = scriptContent.indexOf("__sveltekit_", pointer + "__sveltekit_".length);
    }

    const dataMarker = scriptContent.indexOf("data:");
    if (dataMarker !== -1) {
      const listStart = scriptContent.indexOf("[", dataMarker);
      if (listStart !== -1) {
        const listLiteral = extractBalancedSection(scriptContent, listStart, "[", "]");
        if (listLiteral) {
          const payloadData = safeEvaluate(`(${listLiteral})`);
          if (Array.isArray(payloadData)) return payloadData;
        }
      }
    }
  }

  return null;
}

function resolveAbsoluteUrl(urlCandidate: unknown, domain: string = DEFAULT_DOMAIN): string | null {
  if (!urlCandidate || typeof urlCandidate !== "string") return null;
  try {
    return new URL(urlCandidate, `https://${domain}`).toString();
  } catch {
    return null;
  }
}

function normalizeInputUrl(urlCandidate: unknown, domain: string = DEFAULT_DOMAIN): string {
  const normalized = resolveAbsoluteUrl(urlCandidate, domain);
  if (!normalized) throw ApiError.badRequest("URL invalida");
  return normalized;
}

function detectDomain(urlCandidate: string): string {
  try {
    return new URL(urlCandidate).hostname || DEFAULT_DOMAIN;
  } catch {
    return DEFAULT_DOMAIN;
  }
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function parseEpisodeNumberFromUrl(url: string): number | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const number = Number(lastSegment);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

function normalizeServerName(serverName: unknown, url: string | null): { name: string; token: string } {
  const source = `${serverName || ""} ${url || ""}`.trim();
  for (const known of SERVER_PATTERNS) {
    if (known.test.test(source)) return known;
  }

  if (serverName && typeof serverName === "string") {
    return { name: serverName.trim(), token: serverName.toLowerCase().replace(/[^a-z0-9]+/g, "").trim() };
  }

  try {
    const host = new URL(String(url)).hostname.replace(/^www\./, "");
    return { name: host, token: host.toLowerCase().replace(/[^a-z0-9]+/g, "") };
  } catch {
    return { name: "Unknown", token: "unknown" };
  }
}

interface LinkRecord {
  server: string;
  token: string;
  url: string;
  quality: string | null;
}

function normalizeLinkObject(entry: unknown, domain: string): LinkRecord | null {
  if (!entry) return null;

  if (typeof entry === "string") {
    const url = resolveAbsoluteUrl(entry, domain);
    if (!url) return null;
    const server = normalizeServerName("", url);
    return { server: server.name, token: server.token, url, quality: null };
  }

  if (!isObject(entry)) return null;

  const urlCandidate =
    entry.url || entry.href || entry.link || entry.embed || entry.streamUrl || entry.downloadUrl || entry.file || entry.source || null;

  const url = resolveAbsoluteUrl(urlCandidate, domain);
  if (!url) return null;

  const server = normalizeServerName(entry.server || entry.name || entry.provider || entry.host, url);
  const quality =
    (entry.quality as string) ||
    (entry.resolution as string) ||
    (entry.label as string) ||
    (typeof entry.size === "string" ? entry.size : null) ||
    null;

  return { server: server.name, token: server.token, url, quality };
}

function inferLinkKind(url: unknown, explicitKind?: "stream" | "download" | null): "stream" | "download" {
  if (explicitKind) return explicitKind;
  if (typeof url !== "string") return "stream";
  if (/(embed|play\/?|m3u8|hls|player\.|uns\.bio|upnshare)/i.test(url)) return "stream";
  return "download";
}

function pushDeduped(target: LinkRecord[], link: LinkRecord | null): void {
  if (!link) return;
  if (!target.some((item) => item.url === link.url)) target.push(link);
}

type LinkCollector = {
  stream: { SUB: LinkRecord[]; DUB: LinkRecord[] };
  download: { SUB: LinkRecord[]; DUB: LinkRecord[] };
};

function parseVariantContainer(
  container: unknown,
  kindHint: "stream" | "download" | null,
  domain: string,
  collector: LinkCollector
): void {
  if (!isObject(container)) return;

  const variantPairs: Array<["SUB" | "DUB", unknown]> = [
    ["SUB", container.SUB ?? container.sub],
    ["DUB", container.DUB ?? container.dub],
  ];

  for (const [variant, value] of variantPairs) {
    if (!value) continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        const normalized = normalizeLinkObject(entry, domain);
        if (!normalized) continue;
        const kind = inferLinkKind(normalized.url, kindHint);
        pushDeduped(collector[kind][variant], normalized);
      }
      continue;
    }

    if (isObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (!Array.isArray(childValue)) {
          const normalized = normalizeLinkObject(childValue, domain);
          if (!normalized) continue;
          const childKind = /download/i.test(childKey)
            ? "download"
            : /stream|embed|server/i.test(childKey)
              ? "stream"
              : inferLinkKind(normalized.url, kindHint);
          pushDeduped(collector[childKind][variant], normalized);
          continue;
        }

        const childKind = /download/i.test(childKey) ? "download" : /stream|embed|server/i.test(childKey) ? "stream" : kindHint || "stream";

        for (const entry of childValue) {
          const normalized = normalizeLinkObject(entry, domain);
          if (!normalized) continue;
          const inferredKind = inferLinkKind(normalized.url, childKind);
          pushDeduped(collector[inferredKind][variant], normalized);
        }
      }
    }
  }
}

function extractLinksFromData(dataRoot: unknown, html: string, domain: string): LinkCollector {
  const collector: LinkCollector = {
    stream: { SUB: [], DUB: [] },
    download: { SUB: [], DUB: [] },
  };

  walk(dataRoot, (node) => {
    if (!isObject(node)) return;

    if (node.streamLinks) parseVariantContainer(node.streamLinks, "stream", domain, collector);
    if (node.downloadLinks) parseVariantContainer(node.downloadLinks, "download", domain, collector);
    if (node.servers) parseVariantContainer(node.servers, "stream", domain, collector);

    const hasVariantShape =
      Object.prototype.hasOwnProperty.call(node, "SUB") ||
      Object.prototype.hasOwnProperty.call(node, "sub") ||
      Object.prototype.hasOwnProperty.call(node, "DUB") ||
      Object.prototype.hasOwnProperty.call(node, "dub");

    if (hasVariantShape) parseVariantContainer(node, null, domain, collector);
  });

  if (collector.stream.SUB.length === 0 && collector.download.SUB.length === 0 && typeof html === "string") {
    const foundUrls = html.match(VIDEO_URL_REGEX) || [];
    for (const rawUrl of foundUrls) {
      const url = resolveAbsoluteUrl(rawUrl, domain);
      if (!url) continue;
      const server = normalizeServerName("", url);
      const link: LinkRecord = { server: server.name, token: server.token, url, quality: null };
      const kind = inferLinkKind(url);
      pushDeduped(collector[kind].SUB, link);
    }
  }

  return collector;
}

function buildExcludedTokens(includeMega: boolean, excludeServersRaw: unknown): Set<string> {
  const excluded = new Set<string>();
  const raw = typeof excludeServersRaw === "string" ? excludeServersRaw : "";
  for (const part of raw.split(",")) {
    const token = part.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
    if (token) excluded.add(token);
  }
  if (!includeMega) excluded.add("mega");
  return excluded;
}

function filterLinksByServers(links: LinkRecord[], excludedTokens: Set<string>): LinkRecord[] {
  return links.filter((link) => {
    const token = (link.token || "").toLowerCase();
    if (excludedTokens.has(token)) return false;
    if (token.includes("mega") && excludedTokens.has("mega")) return false;
    return true;
  });
}

function sanitizeLinksForResponse(links: LinkRecord[]): VideoLink[] {
  return links.map((link) => {
    const result: VideoLink = { server: link.server, url: link.url };
    if (link.quality) result.quality = link.quality;
    return result;
  });
}

function chooseBestMediaCandidate(dataRoot: unknown): JsonObject | null {
  const candidates = collectValuesByKey(dataRoot, "media").filter(isObject);

  walk(dataRoot, (node) => {
    if (!isObject(node)) return;
    if (typeof node.title === "string" && (Array.isArray(node.episodes) || node.description)) {
      candidates.push(node);
    }
  });

  let best: JsonObject | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    let score = 0;
    if (typeof candidate.title === "string") score += 3;
    if (Array.isArray(candidate.episodes)) score += 3;
    if (Array.isArray(candidate.genres)) score += 1;
    if (candidate.description) score += 1;
    if (candidate.poster || candidate.image) score += 1;
    if (candidate.id) score += 1;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function normalizeGenres(genres: unknown): GenreInfo[] {
  if (!Array.isArray(genres)) return [];

  return genres
    .map((genre): GenreInfo | null => {
      if (typeof genre === "string") {
        return { id: null, name: genre, slug: genre.toLowerCase().replace(/\s+/g, "-"), malId: null };
      }
      if (!isObject(genre)) return null;
      return {
        id: (genre.id as string | number) ?? null,
        name: (genre.name as string) || (genre.title as string) || "",
        slug: (genre.slug as string) || null,
        malId: (genre.malId as string | number) ?? (genre.mal_id as string | number) ?? null,
      };
    })
    .filter((genre): genre is GenreInfo => Boolean(genre && genre.name));
}

function normalizeEpisodes(episodes: unknown, domain: string, slug: unknown): EpisodeRef[] {
  if (!Array.isArray(episodes)) return [];

  return episodes
    .map((episode, index): EpisodeRef | null => {
      if (!isObject(episode)) return null;

      const inferredNumber =
        parseNumber(episode.number) ??
        parseNumber(episode.episode) ??
        parseNumber(episode.ep) ??
        parseNumber(episode.order) ??
        index + 1;

      let episodeUrl = resolveAbsoluteUrl(episode.url || episode.href || episode.link, domain);
      if (!episodeUrl && slug && Number.isFinite(inferredNumber)) {
        episodeUrl = resolveAbsoluteUrl(`/media/${slug}/${inferredNumber}`, domain);
      }

      return {
        id: (episode.id as string | number) ?? null,
        number: inferredNumber,
        title: (episode.title as string) || `Episodio ${inferredNumber}`,
        url: episodeUrl,
      };
    })
    .filter((episode): episode is EpisodeRef => Boolean(episode && episode.url));
}

function normalizeAnimeInfo(media: JsonObject, domain: string): AnimeInfoData {
  const episodes = normalizeEpisodes(media.episodes || media.episodeList || [], domain, media.slug);
  const aka = media.aka;

  return {
    id: (media.id as string | number) ?? null,
    title: (media.title as string) || null,
    titleJapanese:
      (isObject(aka) && ((aka["ja-jp"] as string) || (aka["ja"] as string) || (aka.jp as string))) ||
      (media.titleJapanese as string) ||
      null,
    description: (media.description as string) || (media.synopsis as string) || null,
    image: resolveAbsoluteUrl(
      media.poster || media.image || media.cover || (media.id ? `https://cdn.animeav1.com/covers/${media.id}.jpg` : null),
      domain
    ),
    backdrop: resolveAbsoluteUrl(media.backdrop || media.banner || media.thumbnail, domain),
    status: (isObject(media.status) ? (media.status.name as string) : (media.status as string)) || null,
    type: (isObject(media.category) ? (media.category.name as string) : (media.type as string)) || null,
    year: media.year ? String(media.year) : null,
    startDate: (media.startDate as string) || (media.start_date as string) || null,
    endDate: (media.endDate as string) || (media.end_date as string) || null,
    score: parseNumber(media.score),
    votes: parseNumber(media.votes || media.scoreVotes || media.voters),
    totalEpisodes: parseNumber(media.totalEpisodes) || episodes.length,
    malId: (media.malId as string | number) ?? (media.mal_id as string | number) ?? null,
    trailer: resolveAbsoluteUrl(media.trailer, domain),
    genres: normalizeGenres(media.genres),
    episodes,
  };
}

function chooseLikelySearchArray(dataRoot: unknown): unknown[] | null {
  const candidateArrays = collectArrays(dataRoot).filter((array) => array.length > 0 && array.length <= 300);

  let bestArray: unknown[] | null = null;
  let bestScore = -1;

  for (const array of candidateArrays) {
    let totalScore = 0;
    let objectItems = 0;

    for (const item of array) {
      if (!isObject(item)) continue;

      objectItems += 1;
      let score = 0;

      if (typeof item.title === "string" || typeof item.name === "string") score += 2;
      if (typeof item.slug === "string" || typeof item.url === "string") score += 2;
      if (item.poster || item.image || item.backdrop) score += 1;
      if (item.category || item.type) score += 1;
      if (item.status || item.year) score += 0.5;
      if (item.description || item.synopsis) score += 0.5;

      totalScore += score;
    }

    if (objectItems === 0) continue;

    const averageScore = totalScore / objectItems;
    if (averageScore > bestScore) {
      bestScore = averageScore;
      bestArray = array;
    }
  }

  return bestScore >= 2 ? bestArray : null;
}

function mapSearchResults(array: unknown[], domain: string): SearchResultItem[] {
  return array
    .map((item): SearchResultItem | null => {
      if (!isObject(item)) return null;

      const title = (item.title as string) || (item.name as string) || null;
      if (!title) return null;

      const slug = (item.slug as string) || null;
      const url = resolveAbsoluteUrl(item.url || item.href || (slug ? `/media/${slug}` : null), domain);
      if (!url) return null;

      let img = (item.poster as string) || (item.image as string) || (item.cover as string) || null;
      if (!img && item.id) img = `https://cdn.animeav1.com/covers/${item.id}.jpg`;

      return {
        id: (item.id as string | number) ?? null,
        title,
        slug,
        url,
        image: resolveAbsoluteUrl(img, domain),
        backdrop: resolveAbsoluteUrl(item.backdrop || item.banner, domain),
        type: (isObject(item.category) ? (item.category.name as string) : (item.type as string)) || null,
        score: parseNumber(item.score),
        status: (isObject(item.status) ? (item.status.name as string) : (item.status as string)) || null,
        year: item.year ? String(item.year) : null,
      };
    })
    .filter((item): item is SearchResultItem => Boolean(item));
}

function normalizeTextForSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

function filterSearchResultsByQuery(results: SearchResultItem[], query: string): SearchResultItem[] {
  const normalizedQuery = normalizeTextForSearch(query);
  if (!normalizedQuery) return results.slice(0, 20);

  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  const scored: Array<{ result: SearchResultItem; score: number }> = [];

  for (const result of results) {
    const title = normalizeTextForSearch(result.title);
    const slug = normalizeTextForSearch(result.slug);
    const combined = `${title} ${slug}`.trim();

    let score = 0;
    if (title === normalizedQuery || slug === normalizedQuery) score += 5;
    if (title.includes(normalizedQuery) || slug.includes(normalizedQuery)) score += 3;

    for (const term of queryTerms) {
      if (term.length < 2) continue;
      if (combined.includes(term)) score += 1;
    }

    if (score > 0) scored.push({ result, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.result).slice(0, 20);
}

function parseSearchResultsFromHtml(html: string, domain: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  const results: SearchResultItem[] = [];

  $("a[href^='/media/']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || !/^\/media\/[^/]+$/i.test(href)) return;

    const card = $(element).closest("article").length ? $(element).closest("article") : $(element);
    const title =
      card.find("h3, h2, [title]").first().text().trim() || card.find("img").first().attr("alt") || $(element).attr("title") || null;

    if (!title) return;

    const slug = href.replace(/^\/media\//, "").trim();
    const image = resolveAbsoluteUrl(card.find("img").first().attr("src"), domain);

    results.push({
      id: null,
      title,
      slug,
      url: resolveAbsoluteUrl(href, domain),
      image,
      backdrop: null,
      type: null,
      score: null,
      status: null,
      year: null,
    });
  });

  const unique: SearchResultItem[] = [];
  const seenUrls = new Set<string>();
  for (const item of results) {
    if (!item.url || seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    unique.push(item);
  }

  return unique;
}

function firstObjectByKey(dataRoot: unknown, keyName: string): JsonObject | null {
  const values = collectValuesByKey(dataRoot, keyName);
  for (const value of values) {
    if (isObject(value)) return value;
  }
  return null;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

export async function getAnimeInfo(urlCandidate: unknown): Promise<ProviderResponse<AnimeInfoData>> {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const domain = detectDomain(normalizedUrl);
  const html = await fetchHtml(normalizedUrl);

  const svelteData = extractSvelteData(html);
  if (!svelteData) throw new ApiError(500, "No se pudo extraer informacion del anime");

  const media = chooseBestMediaCandidate(svelteData);
  if (!media) throw ApiError.notFound("No se encontro informacion del anime");

  return { success: true, data: normalizeAnimeInfo(media, domain), source: "json" };
}

export async function searchAnime(query: unknown, domainCandidate?: unknown): Promise<ProviderResponse<SearchData>> {
  const cleanQuery = String(query ?? "").trim();
  if (!cleanQuery) throw ApiError.badRequest("Se requiere el parametro q");

  const domain = String(domainCandidate || DEFAULT_DOMAIN || "animeav1.com").trim();

  let bestResults: SearchResultItem[] = [];
  let bestSource: "json" | "html" = "html";

  const candidates = [
    { key: "search", value: cleanQuery },
    { key: "q", value: cleanQuery },
  ];

  for (const candidate of candidates) {
    const searchUrl = `https://${domain}/catalogo?${candidate.key}=${encodeURIComponent(candidate.value)}`;
    const html = await fetchHtml(searchUrl);

    let results: SearchResultItem[] = [];
    const svelteData = extractSvelteData(html);
    if (svelteData) {
      const bestArray = chooseLikelySearchArray(svelteData);
      if (bestArray) results = mapSearchResults(bestArray, domain);
    }

    if (results.length === 0) results = parseSearchResultsFromHtml(html, domain);

    results = filterSearchResultsByQuery(results, cleanQuery);

    if (results.length > bestResults.length) {
      bestResults = results;
      bestSource = svelteData ? "json" : "html";
    }

    if (bestResults.length >= 5) break;
  }

  return {
    success: true,
    data: { query: cleanQuery, results: bestResults, count: bestResults.length },
    source: bestSource,
  };
}

export async function getEpisodeLinks(
  urlCandidate: unknown,
  includeMegaRaw?: unknown,
  excludeServersRaw?: unknown
): Promise<ProviderResponse<EpisodeLinksData>> {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const domain = detectDomain(normalizedUrl);
  const includeMega = parseBoolean(includeMegaRaw);
  const excludedTokens = buildExcludedTokens(includeMega, excludeServersRaw);

  const html = await fetchHtml(normalizedUrl);
  const svelteData = extractSvelteData(html);
  const dataRoot = svelteData || {};

  const episodeObject = firstObjectByKey(dataRoot, "episode") || {};
  const links = extractLinksFromData(dataRoot, html, domain);

  const filteredStreamSub = filterLinksByServers(links.stream.SUB, excludedTokens);
  const filteredStreamDub = filterLinksByServers(links.stream.DUB, excludedTokens);
  const filteredDownloadSub = filterLinksByServers(links.download.SUB, excludedTokens);
  const filteredDownloadDub = filterLinksByServers(links.download.DUB, excludedTokens);

  const streamLinks: VariantLinks = {
    SUB: sanitizeLinksForResponse(filteredStreamSub),
    DUB: sanitizeLinksForResponse(filteredStreamDub),
  };
  const downloadLinks: VariantLinks = {
    SUB: sanitizeLinksForResponse(filteredDownloadSub),
    DUB: sanitizeLinksForResponse(filteredDownloadDub),
  };

  return {
    success: true,
    data: {
      id: (episodeObject.id as string | number) ?? null,
      episode:
        parseNumber(episodeObject.number) || parseNumber(episodeObject.episode) || parseEpisodeNumberFromUrl(normalizedUrl),
      title: (episodeObject.title as string) || `Episodio ${parseEpisodeNumberFromUrl(normalizedUrl) ?? "?"}`,
      season: (episodeObject.season as number) ?? null,
      variants: {
        SUB: filteredStreamSub.length > 0 || filteredDownloadSub.length > 0 ? 1 : 0,
        DUB: filteredStreamDub.length > 0 || filteredDownloadDub.length > 0 ? 1 : 0,
      },
      publishedAt: (episodeObject.publishedAt as string) || (episodeObject.published_at as string) || null,
      servers: { sub: streamLinks.SUB, dub: streamLinks.DUB },
      streamLinks,
      downloadLinks,
    },
    source: svelteData ? "json" : "html",
  };
}

export async function getCatalog(page?: unknown, genre?: unknown): Promise<ProviderResponse<CatalogData>> {
  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const domain = DEFAULT_DOMAIN;

  let catalogUrl = `https://${domain}/catalogo?page=${pageNum}`;
  if (typeof genre === "string" && genre.trim()) {
    catalogUrl += `&genre=${encodeURIComponent(genre.trim())}`;
  }

  const html = await fetchHtml(catalogUrl);

  let results: SearchResultItem[] = [];
  const svelteData = extractSvelteData(html);
  if (svelteData) {
    const bestArray = chooseLikelySearchArray(svelteData);
    if (bestArray) results = mapSearchResults(bestArray, domain);
  }

  if (results.length === 0) results = parseSearchResultsFromHtml(html, domain);

  return {
    success: true,
    data: {
      page: pageNum,
      genre: typeof genre === "string" ? genre : null,
      results,
      count: results.length,
      hasMore: results.length >= 10,
    },
    source: svelteData ? "json" : "html",
  };
}
