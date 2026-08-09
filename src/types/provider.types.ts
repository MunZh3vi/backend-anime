// Contrato compartido por todos los proveedores (AnimeFLV, AnimeAV1, JKAnime,
// TioAnime, MonosChinos, HentaiLA). Cada servicio de proveedor devuelve estas
// formas para que las rutas y el orquestador (anime.service.ts) no necesiten
// conocer los detalles internos de cada fuente.

export interface SearchResultItem {
  id: string | number | null;
  title: string;
  slug: string | null;
  url: string | null;
  image: string | null;
  backdrop: string | null;
  type: string | null;
  score: number | null;
  status: string | null;
  year: string | null;
  provider?: string;
}

export interface GenreInfo {
  id: string | number | null;
  name: string;
  slug: string | null;
  malId: string | number | null;
}

export interface EpisodeRef {
  id: string | number | null;
  number: number;
  title: string;
  url: string | null;
}

// "type" es el código numérico de relación tal cual lo expone la fuente
// (AnimeAV1 lo hereda de AniDB): no lo traducimos a texto porque no hay
// forma confiable de mapearlo sin arriesgar una etiqueta incorrecta.
export interface RelatedAnimeItem {
  type: number | null;
  title: string;
  slug: string | null;
  url: string | null;
  startDate: string | null;
}

export interface AnimeInfoData {
  id: string | number | null;
  title: string | null;
  titleJapanese: string | null;
  description: string | null;
  image: string | null;
  backdrop: string | null;
  status: string | null;
  type: string | null;
  year: string | null;
  startDate: string | null;
  endDate: string | null;
  score: number | null;
  votes: number | null;
  totalEpisodes: number;
  malId: string | number | null;
  trailer: string | null;
  genres: GenreInfo[];
  episodes: EpisodeRef[];
  // Solo AnimeAV1 la expone hoy; el resto de los proveedores la dejan undefined.
  relations?: RelatedAnimeItem[];
}

export interface VideoLink {
  server: string;
  token?: string;
  url: string;
  quality?: string | null;
}

export interface VariantLinks {
  SUB: VideoLink[];
  DUB: VideoLink[];
}

export interface EpisodeLinksData {
  id: string | number | null;
  episode: number | null;
  title: string;
  season: number | null;
  variants: { SUB: number; DUB: number };
  publishedAt: string | null;
  servers: { sub: VideoLink[]; dub: VideoLink[] };
  streamLinks: VariantLinks;
  downloadLinks: VariantLinks;
}

export interface CatalogData {
  page: number;
  genre: string | null;
  results: SearchResultItem[];
  count: number;
  hasMore: boolean;
}

export interface SearchData {
  query: string;
  results: SearchResultItem[];
  count: number;
}

export interface ProviderResponse<T> {
  success: true;
  data: T;
  source: string;
}

export interface AnimeProvider {
  id: string;
  searchAnime(query: unknown, domain?: unknown): Promise<ProviderResponse<SearchData>>;
  getAnimeInfo(url: unknown): Promise<ProviderResponse<AnimeInfoData>>;
  getEpisodeLinks(
    url: unknown,
    includeMega?: unknown,
    excludeServers?: unknown
  ): Promise<ProviderResponse<EpisodeLinksData>>;
  getCatalog?(page?: unknown, genre?: unknown): Promise<ProviderResponse<CatalogData>>;
}
