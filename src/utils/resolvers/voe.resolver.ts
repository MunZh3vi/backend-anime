import * as cheerio from "cheerio";
import { axiosGet } from "../resolverHelpers";
import { logger } from "../logger";

function rot13(str: string): string {
  return str.replace(/[A-Za-z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < "n" ? 13 : -13))
  );
}

function sanitizeSpecialChars(str: string): string {
  const patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
  for (const p of patterns) {
    const regex = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    str = str.replace(regex, "_");
  }
  return str;
}

function removeUnderscores(str: string): string {
  return str.split("_").join("");
}

function decodeBase64(str: string): string {
  return Buffer.from(str, "base64").toString("utf-8");
}

function shiftChars(str: string, shift: number): string {
  return str
    .split("")
    .map((c) => String.fromCharCode(c.charCodeAt(0) - shift))
    .join("");
}

function reverseString(str: string): string {
  return str.split("").reverse().join("");
}

interface VoePayload {
  direct_access_url?: string;
  source?: string;
}

function decodeObfuscatedData(obfuscated: string): VoePayload | null {
  try {
    let step = rot13(obfuscated);
    step = sanitizeSpecialChars(step);
    step = removeUnderscores(step);
    step = decodeBase64(step);
    step = shiftChars(step, 3);
    step = reverseString(step);
    step = decodeBase64(step);
    return JSON.parse(step) as VoePayload;
  } catch (err) {
    logger.debug("[VOE Resolver] Error decodificando datos", { err });
    return null;
  }
}

export async function extractVoe(pageUrl: string): Promise<string | null> {
  logger.debug(`[VOE RESOLVER] Resolviendo: ${pageUrl}`);
  try {
    let html: string;
    try {
      const res = await axiosGet(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
          "Accept-Encoding": "gzip, deflate, br",
        },
        timeout: 8000,
      });
      html = res.data;
    } catch (err) {
      logger.debug("[VOE RESOLVER] Error descargando página", { err });
      return null;
    }

    // Detectar redirección JS
    if (html.includes("window.location.href")) {
      const match = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        try {
          const redirectRes = await axiosGet(match[1], {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
              "Accept-Encoding": "gzip, deflate, br",
            },
            timeout: 8000,
          });
          html = redirectRes.data;
        } catch (err) {
          logger.debug("[VOE RESOLVER] Error descargando URL redirigida", { err });
          return null;
        }
      }
    }

    const $ = cheerio.load(html);

    const scripts = $('script[type="application/json"]').toArray();
    let obfuscated: string | null = null;
    for (const el of scripts) {
      const content = $(el).html();
      if (!content) continue;
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && typeof parsed[0] === "string") {
          obfuscated = content;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!obfuscated) {
      logger.debug("[VOE RESOLVER] No se encontró el script JSON ofuscado");
      return null;
    }

    const data = decodeObfuscatedData(obfuscated);
    if (!data) {
      logger.debug("[VOE RESOLVER] Falló decodificación de datos ofuscados");
      return null;
    }

    return data.direct_access_url || data.source || null;
  } catch (err) {
    logger.debug("[VOE RESOLVER] Error inesperado", { err });
    return null;
  }
}
