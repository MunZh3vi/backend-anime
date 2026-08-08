import axios from "axios";
import * as cheerio from "cheerio";
import vm from "node:vm";
import { ApiError } from "../utils/ApiError";
import { getBrowser } from "../utils/browser";
import { logger } from "../utils/logger";
import {
  AnimeInfoData,
  CatalogData,
  EpisodeLinksData,
  EpisodeRef,
  GenreInfo,
  ProviderResponse,
  SearchData,
  SearchResultItem,
  VideoLink,
} from "../types/provider.types";

const DEFAULT_DOMAIN = process.env.ANIMEFLV_DOMAIN || "animeflv.net";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

async function fetchHtmlWithPuppeteer(url: string): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  let retries = 0;
  while (retries < 10) {
    const content = await page.content();
    const $ = cheerio.load(content);
    const title = $("title").text();
    const bodyText = $("body").text().trim();

    if (title && !title.includes("animeflv") && !title.includes("Checking")) break;
    if (bodyText.length > 500) break;

    await new Promise((r) => setTimeout(r, 2000));
    retries++;
  }

  const content = await page.content();
  await page.close();
  return content;
}

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
    try {
      logger.debug(`fetchHtml: probando con Puppeteer compartido para ${url}`);
      return await fetchHtmlWithPuppeteer(url);
    } catch (puppeteerError) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(500, "No se pudo obtener contenido desde AnimeFLV", message);
    }
  }
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

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function parseEpisodeNumberFromUrl(url: string | null): number | null {
  if (!url) return null;
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const match = lastSegment.match(/(\d+)(?:\D*)$/);
    const number = Number(match?.[1]);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeServerName(serverName: unknown, url: string): { name: string; token: string } {
  if (serverName && typeof serverName === "string") {
    const token = normalizeToken(serverName);
    if (token) return { name: serverName.trim(), token };
  }

  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return { name: host, token: normalizeToken(host) };
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

function pushDeduped(target: LinkRecord[], link: LinkRecord | null): void {
  if (!link || !link.url) return;
  if (target.some((item) => item.url === link.url)) return;
  target.push(link);
}

function buildExcludedTokens(includeMega: boolean, excludeServersRaw: unknown): Set<string> {
  const excluded = new Set<string>();
  const raw = typeof excludeServersRaw === "string" ? excludeServersRaw : "";
  for (const part of raw.split(",")) {
    const token = normalizeToken(part);
    if (token) excluded.add(token);
  }
  if (!includeMega) excluded.add("mega");
  return excluded;
}

function filterLinksByServers(links: LinkRecord[], excludedTokens: Set<string>): LinkRecord[] {
  return links.filter((link) => {
    const token = normalizeToken(link.token || link.server);
    if (!token) return true;
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

function extractVarLiteral(html: string, varName: string): string | null {
  const marker = `var ${varName}`;
  const startIndex = html.indexOf(marker);
  if (startIndex === -1) return null;

  const equalsIndex = html.indexOf("=", startIndex);
  if (equalsIndex === -1) return null;

  const slice = html.slice(equalsIndex + 1);
  const firstBracketIndex = slice.search(/[[{]/);
  if (firstBracketIndex === -1) return null;

  const openChar = slice[firstBracketIndex];
  const closeChar = openChar === "{" ? "}" : "]";
  return extractBalancedSection(slice, firstBracketIndex, openChar, closeChar);
}

function normalizeVariantKey(value: unknown): "SUB" | "DUB" {
  const normalized = normalizeToken(value);
  if (!normalized) return "SUB";
  if (normalized.includes("sub") || normalized.includes("jap") || normalized.includes("jp")) return "SUB";
  return "DUB";
}

function tryDecodeBase64(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  try {
    if (/^[A-Za-z0-9+/=]+$/.test(value) && value.length > 10) {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) return decoded;
    }
  } catch {
    // ignorar
  }
  return null;
}

function decodeUrlEscapes(value: unknown): string {
  if (!value || typeof value !== "string") return String(value ?? "");
  return value.replace(/\\u0026/g, "&").replace(/\\u003A/g, ":").replace(/\\u002F/g, "/").replace(/&amp;/g, "&");
}

function buildLinkRecord(serverName: unknown, url: string | null, quality: string | null): LinkRecord | null {
  if (!url) return null;
  const server = normalizeServerName(serverName, url);
  return { server: server.name, token: server.token, url, quality: quality || null };
}

function parseSearchResultsFromHtml(html: string, domain: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  const results: SearchResultItem[] = [];

  $("article.Anime, .ListAnimes li article").each((_, element) => {
    const card = $(element);
    const link = card.find("a[href^='/anime/']").first().attr("href") || card.find("a").first().attr("href");
    const title = card.find("h3.Title").first().text().trim() || card.find("img").attr("alt") || null;
    const image = card.find("img").first().attr("src") || card.find("img").first().attr("data-src") || null;

    if (!link || !title) return;

    const slug = link.split("/").filter(Boolean).pop() || null;

    results.push({
      id: null,
      title,
      slug,
      url: resolveAbsoluteUrl(link, domain),
      image: resolveAbsoluteUrl(image, domain),
      backdrop: null,
      type: card.find(".Type").first().text().trim() || null,
      score: null,
      status: null,
      year: null,
    });
  });

  return results;
}

function parseAnimeInfoFromHtml(html: string) {
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim() || null;
  const description =
    $(".Description").first().text().trim() || $(".Anime-Description").first().text().trim() || null;
  const image = $(".AnimeCover img").attr("src") || $(".cover img").attr("src") || $(".Anime img").attr("src") || null;

  const genres: GenreInfo[] = [];
  $(".Nvgnrs a, .ListAnmRel a").each((_, link) => {
    const name = $(link).text().trim();
    if (!name) return;
    genres.push({ id: null, name, slug: name.toLowerCase().replace(/\s+/g, "-"), malId: null });
  });

  return { title, description, image, genres, type: $(".Type").first().text().trim() || null };
}

function parseEpisodesFromHtml(html: string, domain: string): EpisodeRef[] {
  const $ = cheerio.load(html);
  const episodes: EpisodeRef[] = [];

  $("a[href^='/ver/'], a[href*='/ver/']").each((_, element) => {
    const link = $(element).attr("href");
    if (!link) return;

    const url = resolveAbsoluteUrl(link, domain);
    const number = parseEpisodeNumberFromUrl(url);
    if (!number) return;

    if (episodes.some((ep) => ep.url === url)) return;

    episodes.push({ id: null, number, title: `Episodio ${number}`, url });
  });

  return episodes;
}

function parseEpisodeListFromScript(html: string, domain: string, slug: string | null): EpisodeRef[] {
  const episodesLiteral = extractVarLiteral(html, "episodes");
  if (!episodesLiteral) return [];

  const list = safeEvaluate(`(${episodesLiteral})`);
  if (!Array.isArray(list)) return [];

  return list
    .map((entry): EpisodeRef | null => {
      if (!Array.isArray(entry) || entry.length === 0) return null;

      const number = parseNumber(entry[0]);
      if (number === null) return null;

      const episodeSlug = slug ? `${slug}-${number}` : null;
      const url = episodeSlug ? `https://${domain}/ver/${episodeSlug}` : null;

      return { id: entry[1] ?? null, number, title: `Episodio ${number}`, url };
    })
    .filter((episode): episode is EpisodeRef => Boolean(episode && episode.url));
}

interface RawVideoEntry {
  code?: string;
  url?: string;
  embed?: string;
  file?: string;
  title?: string;
  server?: string;
}

function parseVideoSources(html: string): Record<string, RawVideoEntry[]> | null {
  const videosLiteral = extractVarLiteral(html, "videos");
  if (!videosLiteral) return null;

  const parsed = safeEvaluate(`(${videosLiteral})`);
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed as Record<string, RawVideoEntry[]>;
  for (const entries of Object.values(record)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      for (const field of ["code", "url", "embed", "file"] as const) {
        const value = entry[field];
        if (value && typeof value === "string") {
          const decoded = tryDecodeBase64(value);
          entry[field] = decoded || decodeUrlEscapes(value);
        }
      }
    }
  }

  return record;
}

interface DownloadRow {
  server: string | null;
  format: string | null;
  variant: string | null;
  url: string | null;
}

function parseDownloadRows(html: string, domain: string): DownloadRow[] {
  const $ = cheerio.load(html);
  const rows: DownloadRow[] = [];

  $("table tbody tr").each((_, element) => {
    const cells = $(element).find("td");
    const server = $(cells[0]).text().trim() || null;
    const format = $(cells[1]).text().trim() || null;
    const variant = $(cells[2]).text().trim() || null;
    const url = $(element).find("a").attr("href") || null;

    if (!url) return;

    rows.push({ server, format, variant, url: resolveAbsoluteUrl(url, domain) });
  });

  return rows;
}

export async function searchAnime(query: unknown, domainCandidate?: unknown): Promise<ProviderResponse<SearchData>> {
  const cleanQuery = String(query ?? "").trim();
  if (!cleanQuery) throw ApiError.badRequest("Se requiere el parametro q");

  const domain = String(domainCandidate || DEFAULT_DOMAIN || "www4.animeflv.net").trim();
  const html = await fetchHtml(`https://${domain}/browse?q=${encodeURIComponent(cleanQuery)}`);
  const results = parseSearchResultsFromHtml(html, domain);

  return { success: true, data: { query: cleanQuery, results, count: results.length }, source: "animeflv" };
}

export async function getAnimeInfo(urlCandidate: unknown): Promise<ProviderResponse<AnimeInfoData>> {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const parsed = new URL(normalizedUrl);
  const domain = parsed.hostname || DEFAULT_DOMAIN;
  const segments = parsed.pathname.split("/").filter(Boolean);

  let slug = segments[1] || "";
  if (segments[0] === "ver") {
    slug = (segments[1] || "").replace(/-\d+$/, "");
  }
  if (segments[0] === "anime") {
    slug = segments[1] || "";
  }

  if (!slug) throw ApiError.badRequest("URL invalida");

  const html = await fetchHtml(`https://${domain}/anime/${slug}`);
  const info = parseAnimeInfoFromHtml(html);
  let episodes = parseEpisodesFromHtml(html, domain);
  if (episodes.length === 0) {
    episodes = parseEpisodeListFromScript(html, domain, slug);
  }

  return {
    success: true,
    data: {
      id: null,
      title: info.title,
      titleJapanese: null,
      description: info.description,
      image: resolveAbsoluteUrl(info.image, domain),
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
      genres: info.genres,
      episodes,
    },
    source: "animeflv",
  };
}

export async function getEpisodeLinks(
  urlCandidate: unknown,
  includeMegaRaw?: unknown,
  excludeServersRaw?: unknown
): Promise<ProviderResponse<EpisodeLinksData>> {
  const normalizedUrl = normalizeInputUrl(urlCandidate);
  const epDomain = new URL(normalizedUrl).hostname || DEFAULT_DOMAIN;
  const includeMega = String(includeMegaRaw).toLowerCase() === "true";
  const excludedTokens = buildExcludedTokens(includeMega, excludeServersRaw);

  const html = await fetchHtml(normalizedUrl);

  const streamLinks: Record<"SUB" | "DUB", LinkRecord[]> = { SUB: [], DUB: [] };
  const downloadLinks: Record<"SUB" | "DUB", LinkRecord[]> = { SUB: [], DUB: [] };

  const videoSources = parseVideoSources(html);
  if (videoSources) {
    for (const [key, entries] of Object.entries(videoSources)) {
      const variant = normalizeVariantKey(key);
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        if (!entry) continue;
        const url = entry.code || entry.url || entry.embed || entry.file || null;
        const serverName = entry.title || entry.server || "Unknown";
        const link = buildLinkRecord(serverName, url, null);
        if (link) pushDeduped(streamLinks[variant], link);
      }
    }
  }

  const downloadRows = parseDownloadRows(html, epDomain);
  for (const row of downloadRows) {
    const variant = normalizeVariantKey(row.variant);
    const link = buildLinkRecord(row.server || "Download", row.url, row.format);
    if (link) pushDeduped(downloadLinks[variant], link);
  }

  const filteredStreamSub = filterLinksByServers(streamLinks.SUB, excludedTokens);
  const filteredStreamDub = filterLinksByServers(streamLinks.DUB, excludedTokens);
  const filteredDownloadSub = filterLinksByServers(downloadLinks.SUB, excludedTokens);
  const filteredDownloadDub = filterLinksByServers(downloadLinks.DUB, excludedTokens);

  const episodeNumber = parseEpisodeNumberFromUrl(normalizedUrl);
  const title = cheerio.load(html)("h1").first().text().trim() || null;

  return {
    success: true,
    data: {
      id: null,
      episode: episodeNumber,
      title: title || `Episodio ${episodeNumber ?? "?"}`,
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
    source: "animeflv",
  };
}

export async function getCatalog(page?: unknown, genre?: unknown): Promise<ProviderResponse<CatalogData>> {
  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const domain = DEFAULT_DOMAIN || "animeflv.net";

  let catalogUrl = `https://${domain}/browse?page=${pageNum}`;
  if (typeof genre === "string" && genre.trim()) {
    catalogUrl += `&genre[]=${encodeURIComponent(genre.trim().toLowerCase())}`;
  }

  const html = await fetchHtml(catalogUrl);
  const results = parseSearchResultsFromHtml(html, domain);

  return {
    success: true,
    data: {
      page: pageNum,
      genre: typeof genre === "string" ? genre : null,
      results,
      count: results.length,
      hasMore: results.length >= 20,
    },
    source: "animeflv",
  };
}
