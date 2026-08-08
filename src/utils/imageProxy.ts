import crypto from "node:crypto";
import { env } from "../config/env";
import { ApiError } from "./ApiError";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  // Deriva una clave de 32 bytes (AES-256) a partir del secreto configurado,
  // sin importar su longitud original.
  return crypto.createHash("sha256").update(env.imageProxySecret).digest();
}

/**
 * Cifra una URL externa (AES-256-GCM) para que el frontend nunca vea el
 * dominio real de la fuente en el query string del proxy de imágenes.
 */
export function encryptImageUrl(url: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptImageUrl(token: string): string {
  let buf: Buffer;
  try {
    buf = Buffer.from(token, "base64url");
  } catch {
    throw ApiError.badRequest("Token de imagen inválido");
  }

  if (buf.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw ApiError.badRequest("Token de imagen inválido");
  }

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw ApiError.badRequest("Token de imagen inválido o alterado");
  }
}

/** Convierte una URL externa en la ruta relativa proxeada + cifrada. */
export function toProxiedImageUrl(rawUrl: unknown): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const token = encryptImageUrl(rawUrl);
    return `/api/v1/anime/image-proxy?u=${token}`;
  } catch {
    return null;
  }
}

const IMAGE_FIELD_NAMES = new Set(["image", "backdrop"]);

/**
 * Recorre recursivamente un objeto/array de respuesta y reemplaza cualquier
 * campo "image"/"backdrop" (URL externa cruda) por su versión proxeada+cifrada.
 * Se aplica una sola vez, justo antes de enviar la respuesta al cliente, en
 * vez de tocar cada scraper individualmente.
 */
export function rewriteImageUrlsDeep<T>(value: T, seen = new Set<unknown>()): T {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) rewriteImageUrlsDeep(item, seen);
    return value;
  }

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (IMAGE_FIELD_NAMES.has(key) && typeof val === "string" && val) {
      (value as Record<string, unknown>)[key] = toProxiedImageUrl(val);
    } else if (val && typeof val === "object") {
      rewriteImageUrlsDeep(val, seen);
    }
  }

  return value;
}
