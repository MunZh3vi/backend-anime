import axios from "axios";
import { URL } from "node:url";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import {
  AnimeInfoData,
  EpisodeLinksData,
  EpisodeRef,
  GenreInfo,
  ProviderResponse,
  SearchData,
  SearchResultItem,
} from "../types/provider.types";

// HentaiLA es una app SvelteKit que expone sus datos de hidratacion via
// endpoints `__data.json`, pero (a diferencia de AnimeAV1) usando el formato
// de serializacion "devalue" de Svelte: cada nodo trae un `schema` (objeto de
// punteros) y un arreglo plano `values` donde esos punteros se resuelven.
// Por eso este servicio no reutiliza el parser de AnimeAV1 (que evalua un
// literal de objeto JS embebido en HTML) sino que resuelve manualmente la
// tabla de referencias del payload JSON.

const DEFAULT_DOMAIN = "hentaila.com";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

type VariantKey = "SUB" | "DUB";

interface ParsedNode {
  schema: Record<string, unknown>;
  values: unknown[];
}

interface LinkRecord {
  server: string;
  url: string;
  quality: string | null;
}

type VariantLinkRecords = Record<VariantKey, LinkRecord[]>;

interface MediaData {
  id: unknown;
  title: unknown;
  slug: unknown;
  synopsis: unknown;
  status: unknown;
  episodesCount: unknown;
  score: unknown;
  votes: unknown;
  malId: unknown;
  startDate: unknown;
  poster: unknown;
  category: Record<string, unknown> | null;
  genres: Record<string, unknown>[];
  episodes: Record<string, unknown>[];
}

// Puertos fieles de resolveDataValue/devalueObject: helpers de resolucion
// "devalue" genericos que el servicio original define pero no invoca fuera de
// si mismos (quedan como utilidades sin uso en el archivo fuente). Se
// traducen igual para mantener paridad 1:1 con el original.
function resolveDataValue(schemaObj: any, values: any, key: any): any {
  const schema = schemaObj[key];
  if (schema === undefined || schema === null) {
    return null;
  }

  if (Array.isArray(schema)) {
    return schema.map((idx: any) => resolveDataValue(idx, values, 0));
  }

  if (typeof schema === "number") {
    return resolveDataValue(values, values, schema);
  }

  if (typeof schema === "object" && schema !== null) {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(schema)) {
      result[k] = resolveDataValue(v, values, v);
    }
    return result;
  }

  return schema;
}

function devalueObject(schema: any, values: any[]): any {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  const result: Record<string, any> = {};
  for (const [key, valueIdx] of Object.entries(schema)) {
    if (typeof valueIdx === "number") {
      result[key] = values[valueIdx];
    } else if (typeof valueIdx === "object" && valueIdx !== null && !Array.isArray(valueIdx)) {
      result[key] = devalueObject(valueIdx, values);
    } else if (Array.isArray(valueIdx)) {
      result[key] = valueIdx.map((idx: any) => {
        if (typeof idx === "number") return values[idx];
        if (typeof idx === "object" && idx !== null && !Array.isArray(idx)) {
          return devalueObject(idx, values);
        }
        return idx;
      });
    } else {
      result[key] = valueIdx;
    }
  }

  return result;
}

function parseSvelteKitNodes(nodes: unknown): (ParsedNode | null)[] | null {
  if (!Array.isArray(nodes)) {
    return null;
  }

  const results: (ParsedNode | null)[] = [];
  for (const rawNode of nodes) {
    const node = rawNode as { type?: string; data?: unknown[] } | null;
    if (!node || node.type !== "data" || !Array.isArray(node.data) || node.data.length === 0) {
      results.push(null);
      continue;
    }

    const schema = node.data[0];
    const values = node.data;

    if (typeof schema === "object" && schema !== null) {
      results.push({ schema: schema as Record<string, unknown>, values });
    } else {
      results.push(null);
    }
  }

  return results;
}

function resolveNodeValue(nodeData: ParsedNode | null, schemaKey: string): unknown {
  if (!nodeData || !nodeData.schema || !Array.isArray(nodeData.values)) {
    return null;
  }

  const idx = nodeData.schema[schemaKey];
  if (typeof idx === "number" && idx >= 0 && idx < nodeData.values.length) {
    return nodeData.values[idx];
  }

  return null;
}

function resolveItemFromData(dataValues: unknown[], schemaIndex: number): Record<string, unknown> | null {
  const itemSchema = dataValues[schemaIndex];
  if (!itemSchema || typeof itemSchema !== "object") {
    return null;
  }

  const item: Record<string, unknown> = {};
  for (const [key, valueIdx] of Object.entries(itemSchema as Record<string, unknown>)) {
    if (typeof valueIdx === "number" && valueIdx < dataValues.length) {
      item[key] = dataValues[valueIdx];
    }
  }

  return item;
}

function resolveResultsArray(dataValues: unknown[], refsArray: unknown): Record<string, unknown>[] {
  if (!Array.isArray(refsArray)) {
    return [];
  }

  return refsArray
    .map((idx) => resolveItemFromData(dataValues, idx as number))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function resolveNodeObject(nodeData: ParsedNode | null, keys: string | string[]): Record<string, unknown> | null {
  if (!nodeData || !nodeData.schema || !Array.isArray(nodeData.values)) {
    return null;
  }

  const result: Record<string, unknown> = {};
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const idx = nodeData.schema[key];
    if (typeof idx === "number" && idx >= 0 && idx < nodeData.values.length) {
      result[key] = nodeData.values[idx];
    }
  }

  return result;
}

async function fetchJson(url: string): Promise<any> {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.get(url, {
      timeout,
      headers: HTTP_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(500, "No se pudo obtener contenido desde HentaiLA", message);
  }
}

function normalizeToken(value: unknown): string {
  return (value || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeVariantKey(value: unknown): VariantKey {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return "SUB";
  }

  if (normalized.includes("sub") || normalized.includes("jap") || normalized.includes("jp")) {
    return "SUB";
  }

  if (normalized.includes("dub") || normalized.includes("lat") || normalized.includes("latin") || normalized.includes("esp")) {
    return "DUB";
  }

  return "SUB";
}

function parseEpisodeNumberFromUrl(url: string): number | null {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    const numberMatch = lastSegment.match(/(\d+)$/);
    return numberMatch ? Number(numberMatch[1]) : null;
  } catch {
    return null;
  }
}

function buildLinkRecord(serverName: unknown, url: unknown, quality: unknown): LinkRecord | null {
  if (!url) {
    return null;
  }

  return {
    server: (serverName as string) || "Unknown",
    url: url as string,
    quality: (quality as string) || null,
  };
}

function parseEmbedsFromNode(nodeData: ParsedNode | null): VariantLinkRecords {
  if (!nodeData || !nodeData.schema) {
    return { SUB: [], DUB: [] };
  }

  const schema = nodeData.schema;
  const data = nodeData.values;

  const embedsIdx = schema["embeds"];
  if (typeof embedsIdx !== "number") {
    return { SUB: [], DUB: [] };
  }

  const embedsRaw = data[embedsIdx];
  if (!embedsRaw || typeof embedsRaw !== "object") {
    return { SUB: [], DUB: [] };
  }

  const result: VariantLinkRecords = { SUB: [], DUB: [] };
  for (const [variantKey, variantIdx] of Object.entries(embedsRaw as Record<string, unknown>)) {
    const variant = normalizeVariantKey(variantKey);

    // variantIdx apunta a un arreglo de referencias de schema
    const refsArray = typeof variantIdx === "number" ? data[variantIdx] : variantIdx;
    if (!Array.isArray(refsArray)) {
      continue;
    }

    const entries = resolveResultsArray(data, refsArray);
    for (const entry of entries) {
      if (!entry || !entry.url) {
        continue;
      }

      const link = buildLinkRecord(entry.server || "Unknown", entry.url, null);
      if (link) {
        result[variant].push(link);
      }
    }
  }

  return result;
}

function parseDownloadsFromNode(nodeData: ParsedNode | null): VariantLinkRecords {
  if (!nodeData || !nodeData.schema) {
    return { SUB: [], DUB: [] };
  }

  const schema = nodeData.schema;
  const data = nodeData.values;

  const downloadsIdx = schema["downloads"];
  if (typeof downloadsIdx !== "number") {
    return { SUB: [], DUB: [] };
  }

  const downloadsRaw = data[downloadsIdx];
  if (!downloadsRaw || typeof downloadsRaw !== "object") {
    return { SUB: [], DUB: [] };
  }

  const result: VariantLinkRecords = { SUB: [], DUB: [] };
  for (const [variantKey, variantIdx] of Object.entries(downloadsRaw as Record<string, unknown>)) {
    const variant = normalizeVariantKey(variantKey);

    const refsArray = typeof variantIdx === "number" ? data[variantIdx] : variantIdx;
    if (!Array.isArray(refsArray)) {
      continue;
    }

    const entries = resolveResultsArray(data, refsArray);
    for (const entry of entries) {
      if (!entry || !entry.url) {
        continue;
      }

      const link = buildLinkRecord(entry.server || "Download", entry.url, entry.quality || entry.server || null);
      if (link) {
        result[variant].push(link);
      }
    }
  }

  return result;
}

function parseMediaFromNode(nodeData: ParsedNode | null): MediaData | null {
  if (!nodeData || !nodeData.schema) {
    return null;
  }

  const data = nodeData.values;

  // Verifica el patron de schema anidado (ej. {"media": 1} -> resolver al schema interno)
  const outerKeys = Object.keys(nodeData.schema);
  let innerSchemaIndex = -1;
  for (const key of outerKeys) {
    const idx = nodeData.schema[key];
    if (typeof idx === "number" && typeof data[idx] === "object" && data[idx] !== null && !Array.isArray(data[idx])) {
      innerSchemaIndex = idx;
      break;
    }
  }

  // Usa el schema interno si se encontro, si no usa el schema externo
  const schema: Record<string, unknown> =
    innerSchemaIndex >= 0 ? (data[innerSchemaIndex] as Record<string, unknown>) : nodeData.schema;

  const get = (key: string): unknown => {
    const idx = schema[key];
    return typeof idx === "number" && idx < data.length ? data[idx] : null;
  };

  const genresRefs = get("genres");
  const genres = Array.isArray(genresRefs) ? resolveResultsArray(data, genresRefs) : [];

  const episodesRefs = get("episodes");
  const episodes = Array.isArray(episodesRefs) ? resolveResultsArray(data, episodesRefs) : [];

  const categoryRaw = get("category");
  const category = categoryRaw && typeof categoryRaw === "object" ? (categoryRaw as Record<string, unknown>) : null;

  return {
    id: get("id"),
    title: get("title"),
    slug: get("slug"),
    synopsis: get("synopsis"),
    status: get("status"),
    episodesCount: get("episodesCount"),
    score: get("score"),
    votes: get("votes"),
    malId: get("malId"),
    startDate: get("startDate"),
    poster: get("poster"),
    category,
    genres,
    episodes,
  };
}

function buildEpisodesList(mediaData: MediaData | null): EpisodeRef[] {
  if (!mediaData || !mediaData.episodes || !Array.isArray(mediaData.episodes)) {
    return [];
  }

  const slug = (mediaData.slug as string) || "";
  return mediaData.episodes
    .filter((ep) => ep && ep.number && ep.id)
    .map((ep) => ({
      id: (ep.id as string | number) ?? null,
      number: ep.number as number,
      title: `Episodio ${ep.number}`,
      url: `https://${DEFAULT_DOMAIN}/ver/${slug}-${ep.number}`,
    }));
}

function slugFromUrl(url: unknown): string | null {
  try {
    const pathname = new URL(url as string).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    return lastSegment.replace(/-\d+$/, "");
  } catch {
    return null;
  }
}

// API publica

export async function searchAnime(query: unknown, domainCandidate?: unknown): Promise<ProviderResponse<SearchData>> {
  const cleanQuery = (query || "").toString().trim();
  if (!cleanQuery) {
    throw ApiError.badRequest("Se requiere el parametro q");
  }

  const domain = (domainCandidate || DEFAULT_DOMAIN).toString().trim();
  const searchUrl = `https://${domain}/catalogo/__data.json?search=${encodeURIComponent(cleanQuery)}`;
  const data = await fetchJson(searchUrl);

  const parsedNodes = parseSvelteKitNodes(data.nodes);
  const catalogNode = parsedNodes && parsedNodes.length > 2 ? parsedNodes[2] : null;

  let results: SearchResultItem[] = [];
  if (catalogNode) {
    const rawResults = resolveNodeValue(catalogNode, "results");
    if (Array.isArray(rawResults)) {
      results = resolveResultsArray(catalogNode.values, rawResults)
        .filter((item) => item && item.title)
        .map((item) => {
          const category = item.category as Record<string, unknown> | undefined;
          return {
            id: (item.id as string | number) || null,
            title: item.title as string,
            slug: (item.slug as string) || null,
            url: `https://${domain}/media/${item.slug}`,
            image: item.id ? `https://cdn.hentaila.com/covers/${item.id}.jpg` : null,
            backdrop: null,
            type: category ? (category.name as string) : null,
            score: (item.score as number) || null,
            status: (item.status as string) || null,
            year: null,
          };
        });
    }
  } else {
    logger.debug("hentaila: no se encontro el nodo de catalogo en __data.json", { domain, cleanQuery });
  }

  return {
    success: true,
    data: {
      query: cleanQuery,
      results,
      count: results.length,
    },
    source: "hentaila",
  };
}

export async function getAnimeInfo(urlCandidate: unknown): Promise<ProviderResponse<AnimeInfoData>> {
  const slug = slugFromUrl(urlCandidate);
  if (!slug) {
    throw ApiError.badRequest("URL invalida");
  }

  const apiUrl = `https://${DEFAULT_DOMAIN}/media/${slug}/__data.json`;
  const data = await fetchJson(apiUrl);

  const parsedNodes = parseSvelteKitNodes(data.nodes);
  const mediaNode = parsedNodes && parsedNodes.length > 2 ? parsedNodes[2] : null;

  if (!mediaNode) {
    throw ApiError.notFound("Anime no encontrado en HentaiLA");
  }

  const mediaData = parseMediaFromNode(mediaNode);
  if (!mediaData) {
    throw ApiError.notFound("Anime no encontrado en HentaiLA");
  }

  const episodes = buildEpisodesList(mediaData);
  const category = mediaData.category;
  const genres = mediaData.genres;

  return {
    success: true,
    data: {
      id: (mediaData.id as string | number) || null,
      title: mediaData.title as string,
      titleJapanese: null,
      description: (mediaData.synopsis as string) || null,
      image: mediaData.id ? `https://cdn.hentaila.com/covers/${mediaData.id}.jpg` : null,
      backdrop: null,
      status: null,
      type: category ? (category.name as string) : null,
      year: mediaData.startDate ? String(mediaData.startDate).split("-")[0] : null,
      startDate: (mediaData.startDate as string) || null,
      endDate: null,
      score: (mediaData.score as number) || null,
      votes: (mediaData.votes as number) || null,
      totalEpisodes: episodes.length,
      malId: (mediaData.malId as string | number) || null,
      trailer: null,
      genres: Array.isArray(genres)
        ? genres.map(
            (g): GenreInfo => ({
              id: (g.id as string | number) || null,
              name: g.name as string,
              slug: (g.slug as string) || (g.name as string).toLowerCase().replace(/\s+/g, "-"),
              malId: (g.malId as string | number) || null,
            })
          )
        : [],
      episodes,
    },
    source: "hentaila",
  };
}

export async function getEpisodeLinks(urlCandidate: unknown): Promise<ProviderResponse<EpisodeLinksData>> {
  const slug = slugFromUrl(urlCandidate);
  const episodeNumber = parseEpisodeNumberFromUrl(urlCandidate as string);

  if (!slug || !episodeNumber) {
    throw ApiError.badRequest("URL invalida - no se pudo extraer slug y numero de episodio");
  }

  const apiUrl = `https://${DEFAULT_DOMAIN}/media/${slug}/${episodeNumber}/__data.json`;
  const data = await fetchJson(apiUrl);

  const parsedNodes = parseSvelteKitNodes(data.nodes);

  // Busca el nodo del episodio - resuelve schemas anidados
  let episodeNode: ParsedNode | null = null;
  for (let i = parsedNodes ? parsedNodes.length - 1 : 0; i >= 0; i--) {
    const node = parsedNodes ? parsedNodes[i] : null;
    if (!node || !node.schema) continue;

    const nodeValues = node.values;

    for (const [key, idx] of Object.entries(node.schema)) {
      if (typeof idx !== "number") continue;

      // Claves directas
      if (key === "embeds" || key === "downloads" || key === "episode") {
        episodeNode = node;
        break;
      }

      // Patron de schema anidado
      const candidate = nodeValues[idx];
      if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
        const inner = candidate as Record<string, unknown>;
        if (inner.embeds !== undefined || inner.downloads !== undefined || inner.episode !== undefined) {
          episodeNode = { schema: inner, values: nodeValues };
          break;
        }
      }
    }

    if (episodeNode) break;
  }

  if (!episodeNode) {
    logger.debug("hentaila: no se encontro el nodo del episodio en __data.json", { slug, episodeNumber });
    return {
      success: true,
      data: {
        id: null,
        episode: episodeNumber,
        title: `Episodio ${episodeNumber}`,
        season: null,
        variants: { SUB: 0, DUB: 0 },
        publishedAt: null,
        servers: { sub: [], dub: [] },
        streamLinks: { SUB: [], DUB: [] },
        downloadLinks: { SUB: [], DUB: [] },
      },
      source: "hentaila",
    };
  }

  const embeds = parseEmbedsFromNode(episodeNode);
  const downloads = parseDownloadsFromNode(episodeNode);
  const epData = resolveNodeObject(episodeNode, ["title", "number"]);

  return {
    success: true,
    data: {
      id: null,
      episode: episodeNumber,
      title:
        embeds.SUB.length > 0 || downloads.SUB.length > 0
          ? epData
            ? (epData.title as string) || `Episodio ${episodeNumber}`
            : `Episodio ${episodeNumber}`
          : `Episodio ${episodeNumber}`,
      season: null,
      variants: {
        SUB: embeds.SUB.length > 0 || downloads.SUB.length > 0 ? 1 : 0,
        DUB: embeds.DUB.length > 0 || downloads.DUB.length > 0 ? 1 : 0,
      },
      publishedAt: null,
      servers: {
        sub: embeds.SUB.map((l) => ({ server: l.server, url: l.url })),
        dub: embeds.DUB.map((l) => ({ server: l.server, url: l.url })),
      },
      streamLinks: {
        SUB: embeds.SUB.map((l) => ({ server: l.server, url: l.url })),
        DUB: embeds.DUB.map((l) => ({ server: l.server, url: l.url })),
      },
      downloadLinks: {
        SUB: downloads.SUB.map((l) => ({
          server: l.server,
          url: l.url,
          quality: l.quality || l.server,
        })),
        DUB: downloads.DUB.map((l) => ({
          server: l.server,
          url: l.url,
          quality: l.quality || l.server,
        })),
      },
    },
    source: "hentaila",
  };
}
