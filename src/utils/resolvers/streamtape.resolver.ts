import vm from "node:vm";
import * as cheerio from "cheerio";
import { axiosGet, UA_FIREFOX } from "../resolverHelpers";
import { logger } from "../logger";

async function checkStLink(url: string): Promise<string | null> {
  try {
    const res = await axiosGet(url, {
      method: "HEAD",
      headers: {
        "User-Agent": UA_FIREFOX,
        Referer: "https://streamtape.com/",
      },
      timeout: 6000,
      maxRedirects: 0,
      validateStatus: () => true,
    });

    const contentType = String(res.headers["content-type"] ?? "");
    if (contentType.includes("application/json")) {
      return null;
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers["location"];
      if (location) {
        return location.startsWith("//") ? `https:${location}` : location;
      }
    }
  } catch (err) {
    logger.debug("[ST RESOLVER] Error en validación HEAD", { err });
    return null;
  }
  return null;
}

/**
 * StreamTape arma el link real con una expresión JS de concatenación/slicing
 * embebida en la página (ej. `'aa' + 'bb'.substring(3)`). En vez de `eval`
 * crudo sobre contenido remoto, se evalúa en un contexto vm aislado con
 * timeout para no correr JS arbitrario con los privilegios del proceso.
 */
function safeEvalExpression(expr: string): string | null {
  try {
    const result = vm.runInNewContext(expr, Object.create(null), { timeout: 1000, displayErrors: false });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

export async function extractStreamtape(pageUrl: string): Promise<string | null> {
  logger.debug(`[ST RESOLVER] Resolviendo: ${pageUrl}`);
  try {
    let html: string;
    try {
      const res = await axiosGet(pageUrl, { headers: { "User-Agent": UA_FIREFOX }, timeout: 8000 });
      html = res.data;
    } catch (err) {
      logger.debug("[ST RESOLVER] Error descargando página", { err });
      return null;
    }

    const $ = cheerio.load(html);
    const scriptElems = $("script").toArray();

    for (const el of scriptElems) {
      const scriptContent = $(el).html();
      if (!scriptContent) continue;

      const regex = /document\.getElementById\(['"]([^'"]+)['"]\)\.innerHTML\s*=\s*(.+);/g;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(scriptContent)) !== null) {
        const expr = match[2].replace(/\+ ?''/g, "").replace(/\.substring\((\d+)\)/g, (_m, p) => `.slice(${p})`);

        const link = safeEvalExpression(expr);
        if (!link) continue;

        let fullLink = link;
        if (fullLink.startsWith("//")) {
          fullLink = `https:${fullLink}`;
        } else if (fullLink.startsWith("/")) {
          fullLink = `https://streamtape.com${fullLink}`;
        }

        const validUrl = await checkStLink(fullLink);
        if (validUrl) {
          logger.debug("[ST RESOLVER] URL directa resuelta", { validUrl });
          return validUrl;
        }
      }
    }

    logger.debug("[ST RESOLVER] No se encontró ningún enlace válido");
    return null;
  } catch (err) {
    logger.debug("[ST RESOLVER] Error general", { err });
    return null;
  }
}
