import { Request, Response } from "express";
import { httpClient } from "../utils/httpClient";
import { ApiError } from "../utils/ApiError";
import { env } from "../config/env";
import { requireQueryString } from "../utils/validators";

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
    throw ApiError.badRequest("El parámetro 'url' no es una URL válida");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw ApiError.badRequest("Solo se permiten URLs http/https");
  }

  if (PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
    throw ApiError.badRequest("Host no permitido");
  }

  // Anti-SSRF: solo se permite proxear imágenes de dominios conocidos de las
  // fuentes de scraping (configurable vía IMAGE_PROXY_ALLOWED_HOSTS).
  const isAllowed = env.imageProxyAllowedHosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );
  if (env.imageProxyAllowedHosts.length > 0 && !isAllowed) {
    throw ApiError.badRequest(`Host no permitido: ${parsed.hostname}`);
  }

  return parsed;
}

export async function proxyImage(req: Request, res: Response) {
  const rawUrl = requireQueryString(req.query.url, "url");
  const target = assertSafeImageUrl(rawUrl);

  const upstream = await httpClient
    .get(target.toString(), { responseType: "stream" })
    .catch(() => {
      throw ApiError.upstream("No se pudo obtener la imagen solicitada");
    });

  const contentType = String(upstream.headers["content-type"] ?? "");
  if (!contentType.startsWith("image/")) {
    throw ApiError.badRequest("La URL solicitada no apunta a una imagen");
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  upstream.data.pipe(res);
}
