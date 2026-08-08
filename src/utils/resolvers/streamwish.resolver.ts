import { detect, unpack } from "unpacker";
import { axiosGet } from "../resolverHelpers";
import { logger } from "../logger";

interface HlsLinks {
  hls1?: string;
  hls2?: string;
  hls3?: string;
  hls4?: string;
}

function bestQualityUrl(master: string, base: string): string | null {
  try {
    const lines = master.split("\n");
    let bestUrl: string | null = null;
    let bestScore = 0;

    for (let i = 0; i < lines.length; i++) {
      const m = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      if (!m) continue;

      const next = lines[i + 1]?.trim();
      if (!next || next.startsWith("#")) continue;

      const score = Number(m[1]) * Number(m[2]);
      if (score > bestScore) {
        bestScore = score;
        bestUrl = new URL(next, base).href;
      }
    }
    return bestUrl;
  } catch {
    return null;
  }
}

// El dominio público de StreamWish rota constantemente por bloqueos DMCA;
// estos son los mirrors conocidos vigentes al momento de escribir esto.
const DMCA_MIRRORS = ["playnixes.com", "niramirus.com", "medixiru.com", "hgplaycdn.com", "hglamioz.com"];
const MAIN_MIRRORS = ["kravaxxa.com", "davioad.com", "haxloppd.com", "tryzendm.com", "dumbalag.com"];
const REDIRECT_HOSTS = ["dhcplay.com", "hglink.to", "test.hglink.to", "wish-redirect.aiavh.com"];

async function redir(pageUrl: string): Promise<string> {
  try {
    const url = new URL(pageUrl);
    const pool = REDIRECT_HOSTS.includes(url.hostname) ? MAIN_MIRRORS : DMCA_MIRRORS;
    const destination = pool[Math.floor(Math.random() * pool.length)];
    return `https://${destination}${url.pathname}${url.search}`;
  } catch (err) {
    logger.debug("[SW RESOLVER] Error generando redirectUrl", { err });
    return pageUrl;
  }
}

export async function extractStreamwish(pageUrl: string): Promise<string | null> {
  logger.debug(`[SW RESOLVER] Resolviendo: ${pageUrl}`);
  try {
    const finalUrl = await redir(pageUrl);

    let html: string;
    try {
      const res = await axiosGet(finalUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
          Accept: "*/*",
          Referer: finalUrl,
        },
      });
      html = res.data;
    } catch (err) {
      logger.debug("[SW RESOLVER] Error con URL redirigida, probando original", { err });
      try {
        const res = await axiosGet(pageUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
            Accept: "*/*",
            Referer: pageUrl,
          },
        });
        html = res.data;
      } catch (errOriginal) {
        logger.debug("[SW RESOLVER] Error con URL original también", { errOriginal });
        return null;
      }
    }

    const scriptMatch = html.match(
      /<script[^>]*type=['"]text\/javascript['"][^>]*>\s*(eval\(function\(p,a,c,k,e,d\)[\s\S]*?)<\/script>/i
    );
    if (!scriptMatch) {
      logger.debug("[SW RESOLVER] Script packed no encontrado");
      return null;
    }

    const packedJs = scriptMatch[1];
    if (!detect(packedJs)) {
      logger.debug("[SW RESOLVER] Script no parece estar empaquetado con Packer");
      return null;
    }

    const unpacked = unpack(packedJs);
    const linksMatch = unpacked.match(/var\s+links\s*=\s*(\{[\s\S]*?\});/i);
    if (!linksMatch) {
      logger.debug("[SW RESOLVER] Objeto links no encontrado en el script unpacked");
      return null;
    }

    let links: HlsLinks;
    try {
      links = JSON.parse(linksMatch[1]) as HlsLinks;
    } catch {
      logger.debug("[SW RESOLVER] Error parseando JSON de links");
      return null;
    }

    const link = links.hls4 || links.hls3 || links.hls1 || links.hls2;
    if (!link) {
      logger.debug("[SW RESOLVER] No se encontró enlace HLS directo");
      return null;
    }

    const masterUrl = link.startsWith("/") ? new URL(link, finalUrl).href : link;

    let playlist: string;
    try {
      const res = await axiosGet(masterUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: finalUrl },
      });
      playlist = res.data;
    } catch (err) {
      logger.debug("[SW RESOLVER] No se pudo obtener el master playlist", { err });
      return masterUrl;
    }

    const base = masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1);
    return bestQualityUrl(playlist, base) || masterUrl;
  } catch (err) {
    logger.debug("[SW RESOLVER] Error", { err });
    return null;
  }
}
