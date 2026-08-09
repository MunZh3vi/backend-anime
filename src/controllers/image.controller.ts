import { Request, Response } from "express";
import { httpClient } from "../utils/httpClient";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";
import { decryptImageUrl } from "../utils/imageProxy";
import { getCachedImage, setCachedImage } from "../cache/imageCache";

const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
];

function assertSafeImageUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw ApiError.badRequest("Token de imagen inválido");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw ApiError.badRequest("Solo se permiten URLs http/https");
  }

  if (PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
    throw ApiError.badRequest("Host no permitido");
  }

  // Anti-SSRF: solo se permite proxear imágenes de dominios conocidos de las
  // fuentes de scraping (configurable vía IMAGE_PROXY_ALLOWED_HOSTS). Se
  // mantiene como defensa en profundidad aunque el token ya venga cifrado.
  const isAllowed = env.imageProxyAllowedHosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );
  if (env.imageProxyAllowedHosts.length > 0 && !isAllowed) {
    throw ApiError.badRequest(`Host no permitido: ${parsed.hostname}`);
  }

  return parsed;
}

export async function proxyImage(req: Request, res: Response) {
  const token = req.query.u;
  const legacyUrl = req.query.url;

  let rawUrl: string;
  if (typeof token === "string" && token) {
    rawUrl = decryptImageUrl(token);
  } else if (typeof legacyUrl === "string" && legacyUrl) {
    // Compat: favoritos/watchlist/historial guardados antes de cifrar las
    // URLs (o un frontend todavía sin actualizar) traen la URL cruda. Se
    // sigue validando contra la lista blanca igual que el token cifrado.
    rawUrl = legacyUrl;
  } else {
    throw ApiError.badRequest("Se requiere el parámetro 'u' (o 'url' por compatibilidad)");
  }

  const target = assertSafeImageUrl(rawUrl);
  const cacheKey = target.toString();

  const cached = getCachedImage(cacheKey);
  if (cached) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Cache", "HIT");
    res.send(cached.buffer);
    return;
  }

  const upstream = await httpClient
    .get(cacheKey, { responseType: "arraybuffer" })
    .catch(() => {
      throw ApiError.upstream("No se pudo obtener la imagen solicitada");
    });

  const contentType = String(upstream.headers["content-type"] ?? "");
  if (!contentType.startsWith("image/")) {
    throw ApiError.badRequest("La URL solicitada no apunta a una imagen");
  }

  const buffer = Buffer.from(upstream.data);
  setCachedImage(cacheKey, { contentType, buffer });

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("X-Cache", "MISS");
  res.send(buffer);
}
