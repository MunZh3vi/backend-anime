import axios from "axios";
import { logger } from "../utils/logger";

export interface AniListArtwork {
  cover: string | null;
  banner: string | null;
}

const QUERY = `
  query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
      coverImage { extraLarge }
      bannerImage
    }
  }
`;

/**
 * AnimeAV1 (y a veces otros proveedores) ya nos da el malId gratis al
 * scrapear. Con eso, AniList (pública, sin API key) devuelve un cover mucho
 * más pesado/nítido que los covers de los sitios de streaming (pensados
 * para grillas chicas, no para un hero a pantalla completa) y un
 * bannerImage ancho que esos sitios ni siquiera tienen.
 */
export async function getArtworkByMalId(malId: number): Promise<AniListArtwork | null> {
  try {
    const response = await axios.post<{
      data?: { Media?: { coverImage?: { extraLarge?: string | null }; bannerImage?: string | null } };
    }>(
      "https://graphql.anilist.co",
      { query: QUERY, variables: { idMal: malId } },
      { timeout: 8000, headers: { "Content-Type": "application/json" } }
    );

    const media = response.data.data?.Media;
    if (!media) return null;

    return {
      cover: media.coverImage?.extraLarge ?? null,
      banner: media.bannerImage ?? null,
    };
  } catch (err) {
    logger.debug("AniList: no se pudo obtener artwork", { malId, err: err instanceof Error ? err.message : err });
    return null;
  }
}
