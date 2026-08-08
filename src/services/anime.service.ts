import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import * as animeav1Service from "./animeav1.service";
import * as animeflvService from "./animeflv.service";
import * as jkanimeService from "./jkanime.service";
import * as hentailaService from "./hentaila.service";
import * as tioanimeService from "./tioanime.service";
import * as monoschinosService from "./monoschinos.service";
import { AnimeInfoData, AnimeProvider, EpisodeLinksData, ProviderResponse, SearchData, SearchResultItem } from "../types/provider.types";

const DEFAULT_ANIME_DOMAIN = process.env.DEFAULT_ANIME_DOMAIN || "animeav1.com";

interface ProviderEntry {
  id: string;
  label: string;
  domains: string[];
  service: Pick<AnimeProvider, "searchAnime" | "getAnimeInfo" | "getEpisodeLinks">;
}

const PROVIDERS: ProviderEntry[] = [
  {
    id: "animeav1",
    label: "AnimeAV1",
    domains: [DEFAULT_ANIME_DOMAIN, "animeav1.com", "www.animeav1.com"],
    service: animeav1Service,
  },
  {
    id: "jkanime",
    label: "JKAnime",
    domains: ["jkanime.net", "www.jkanime.net"],
    service: jkanimeService,
  },
  {
    id: "animeflv",
    label: "AnimeFLV",
    domains: ["animeflv.net", "www.animeflv.net", "www4.animeflv.net"],
    service: animeflvService,
  },
  {
    id: "hentaila",
    label: "HentaiLA",
    domains: ["hentaila.com", "www.hentaila.com"],
    service: hentailaService,
  },
  {
    id: "tioanime",
    label: "TioAnime",
    domains: ["tioanime.com", "www.tioanime.com"],
    service: tioanimeService,
  },
  {
    id: "monoschinos",
    label: "MonosChinos",
    domains: ["monoschinos2.com", "www.monoschinos2.com"],
    service: monoschinosService,
  },
];

function normalizeDomain(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  try {
    if (trimmed.includes("://")) return new URL(trimmed).hostname.toLowerCase();
    return new URL(`https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.split("/")[0];
  }
}

function domainMatches(domain: string, candidate: string): boolean {
  if (!domain || !candidate) return false;
  if (domain === candidate) return true;
  return domain.endsWith(`.${candidate}`);
}

function findProviderByDomain(domainCandidate: unknown): ProviderEntry | null {
  const domain = normalizeDomain(domainCandidate);
  if (!domain) return null;
  return PROVIDERS.find((provider) => provider.domains.some((candidate) => domainMatches(domain, candidate))) || null;
}

function findProviderById(providerId: unknown): ProviderEntry | null {
  if (!providerId || typeof providerId !== "string") return null;
  const normalized = providerId.trim().toLowerCase();
  return PROVIDERS.find((provider) => provider.id === normalized) || null;
}

function findProviderForUrl(urlCandidate: unknown): ProviderEntry | null {
  if (!urlCandidate || typeof urlCandidate !== "string") return null;
  try {
    return findProviderByDomain(new URL(urlCandidate).hostname);
  } catch {
    return null;
  }
}

export async function searchAnime(query: unknown, domainCandidate?: unknown): Promise<ProviderResponse<SearchData>> {
  const forcedProvider = findProviderByDomain(domainCandidate) || findProviderById(domainCandidate);

  if (forcedProvider) {
    const result = await forcedProvider.service.searchAnime(query, forcedProvider.domains[0]);
    result.data.results.forEach((item: SearchResultItem) => {
      item.provider = forcedProvider.label;
      if (item.url) item.slug = item.url;
    });
    return { ...result, source: result.source || forcedProvider.id };
  }

  // Búsqueda unificada en paralelo en todos los proveedores
  const searchResults = await Promise.all(
    PROVIDERS.map(async (provider) => {
      try {
        const result = await provider.service.searchAnime(query, provider.domains[0]);
        const results = result.data.results || [];
        results.forEach((item) => {
          item.provider = provider.label;
          if (item.url) item.slug = item.url;
        });
        return { success: true as const, providerId: provider.id, results, originalResult: result };
      } catch (error) {
        logger.warn(`[SEARCH] Error en proveedor ${provider.id}`, { error });
        return { success: false as const, providerId: provider.id, error };
      }
    })
  );

  const allResults: SearchResultItem[] = [];
  const errors: unknown[] = [];
  let firstEmptyResult: ProviderResponse<SearchData> | null = null;

  for (const res of searchResults) {
    if (res.success) {
      if (res.results.length > 0) {
        allResults.push(...res.results);
      } else if (!firstEmptyResult) {
        firstEmptyResult = res.originalResult;
      }
    } else {
      errors.push(res.error);
    }
  }

  if (allResults.length > 0) {
    return {
      success: true,
      source: "Multi",
      data: { query: String(query ?? ""), results: allResults, count: allResults.length },
    };
  }

  if (firstEmptyResult) {
    return { ...firstEmptyResult, source: "Multi" };
  }

  if (errors.length === PROVIDERS.length && errors[0] instanceof Error) {
    throw errors[0];
  }

  throw ApiError.upstream("No se pudo completar la busqueda en proveedores");
}

export async function getAnimeInfo(urlCandidate: unknown): Promise<ProviderResponse<AnimeInfoData>> {
  const provider = findProviderForUrl(urlCandidate) || PROVIDERS[0];
  if (!provider) throw ApiError.badRequest("Proveedor no soportado");

  const result = await provider.service.getAnimeInfo(urlCandidate);
  return { ...result, source: result.source || provider.id };
}

export async function getEpisodeLinks(
  urlCandidate: unknown,
  includeMega?: unknown,
  excludeServers?: unknown
): Promise<ProviderResponse<EpisodeLinksData>> {
  const provider = findProviderForUrl(urlCandidate) || PROVIDERS[0];
  if (!provider) throw ApiError.badRequest("Proveedor no soportado");

  const result = await provider.service.getEpisodeLinks(urlCandidate, includeMega, excludeServers);
  return { ...result, source: result.source || provider.id };
}

export function getProviderService(providerId: unknown): ProviderEntry["service"] & { getCatalog?: AnimeProvider["getCatalog"] } {
  const provider = findProviderById(providerId);
  if (provider) return provider.service;
  return PROVIDERS[0].service;
}

export function listProviders(): Array<{ id: string; label: string }> {
  return PROVIDERS.map(({ id, label }) => ({ id, label }));
}
