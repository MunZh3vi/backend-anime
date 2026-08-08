import axios from "axios";
import { ApiError } from "./ApiError";

const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": UA_CHROME,
  Accept: "*/*",
};

const HTML_HEADERS = {
  "User-Agent": UA_CHROME,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

function requestTimeoutMs(): number {
  return Number(process.env.REQUEST_TIMEOUT_MS) || 15000;
}

export async function fetchHtml(url: string, customHeaders: Record<string, string> = {}): Promise<string> {
  try {
    const response = await axios.get<string>(url, {
      timeout: requestTimeoutMs(),
      headers: { ...HTML_HEADERS, ...customHeaders },
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(500, `No se pudo obtener el contenido desde ${url}`, message);
  }
}

export async function fetchHtmlWithHeaders(
  url: string,
  referer?: string | null,
  customHeaders: Record<string, string> = {}
): Promise<{ html: string; headers: Record<string, unknown> }> {
  try {
    const headers: Record<string, string> = { ...HTML_HEADERS, ...customHeaders };
    if (referer) {
      headers.Referer = referer;
    }

    const response = await axios.get<string>(url, {
      timeout: requestTimeoutMs(),
      headers,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    return { html: response.data, headers: response.headers as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(500, `Error de red al consultar ${url}`, message);
  }
}

export function resolveAbsoluteUrl(base: string, relative: string | null | undefined): string {
  if (!relative) return "";
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

export function normalizeExtractedUrl(value: unknown): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%3F/gi, "?")
    .replace(/%3D/gi, "=")
    .trim();
}

export function decodeIfEncoded(url: string | null | undefined): string | null | undefined {
  if (!url || typeof url !== "string") {
    return url;
  }

  try {
    if (url.includes("%") && /%[0-9A-Fa-f]{2}/.test(url)) {
      return decodeURIComponent(url);
    }
  } catch {
    // Ignorar errores de decodificación
  }
  return url;
}

const VIDEO_URL_EXCLUDE_PATTERNS = [
  "cloudflareinsights",
  "google-analytics",
  "googletagmanager",
  "facebook.net",
  "beacon.min.js",
  ".js?",
  "analytics",
  "pixel",
  "bigbuckbunny",
  "test-videos",
  "sample-video",
  "placeholder",
];

/**
 * Varios servidores de embed (StreamWish, VOE, VidHide) sirven un video de
 * relleno (ej. Big Buck Bunny) cuando detectan tráfico automatizado en vez de
 * bloquear directamente. Este filtro descarta esos falsos positivos.
 */
export function isLikelyVideoUrl(url: unknown): url is string {
  if (!url || typeof url !== "string") {
    return false;
  }

  const lower = url.toLowerCase();
  if (VIDEO_URL_EXCLUDE_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return false;
  }

  const hasVideoExtension = /\.(?:mp4|m3u8)(?:\?|#|$)/i.test(url);
  return hasVideoExtension || lower.includes("video") || lower.includes("stream");
}

export function findFirstUrl(payload: string | null | undefined, patterns: RegExp[]): string | null {
  if (!payload || typeof payload !== "string") {
    return null;
  }

  for (const pattern of patterns) {
    try {
      const match = payload.match(pattern);
      if (match && match[1]) {
        const candidate = normalizeExtractedUrl(match[1]);
        if (candidate && isLikelyVideoUrl(candidate)) {
          return decodeIfEncoded(candidate) ?? null;
        }
      }
    } catch {
      // Ignorar patrones inválidos
    }
  }

  const urlMatch = payload.match(/(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i);
  if (urlMatch && urlMatch[1]) {
    const candidate = normalizeExtractedUrl(urlMatch[1]);
    if (candidate && isLikelyVideoUrl(candidate)) {
      return decodeIfEncoded(candidate) ?? null;
    }
  }

  return null;
}

export { DEFAULT_HEADERS, HTML_HEADERS };
