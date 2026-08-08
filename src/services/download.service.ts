import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import axios, { AxiosResponse } from "axios";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import {
  DEFAULT_HEADERS,
  HTML_HEADERS,
  fetchHtmlWithHeaders,
  findFirstUrl,
  normalizeExtractedUrl,
} from "../utils/scraperHttp";
import { resolveEmbedUrl as resolveEmbedUrlShared } from "../utils/resolvers/resolvers";
import * as animeService from "./anime.service";
import { EpisodeLinksData, ProviderResponse, VideoLink } from "../types/provider.types";

// El binario estático de ffmpeg puede no existir en algunas plataformas; si
// falta, fluent-ffmpeg usará el "ffmpeg" del PATH del sistema como respaldo.
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type DownloadStatus = "queued" | "preparing" | "downloading" | "completed" | "failed";
export type EpisodeVariant = "SUB" | "DUB";

interface DownloadRecord {
  downloadId: string;
  status: DownloadStatus;
  progress: number;
  url: string;
  quality: string;
  variant: EpisodeVariant;
  createdAt: number;
  updatedAt: number;
  baseUrl: string;
  error: string | null;
  downloadUrl: string | null;
  fileSize: string | null;
  fileName: string | null;
  filePath: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  sourceUrl: string | null;
  currentServer: string | null;
  completedAt: number | null;
}

interface DownloadCandidate {
  server: string;
  url: string;
  quality: string | null;
}

interface CreateDownloadPayload {
  url?: string;
  quality?: string;
  variant?: string;
  includeMega?: boolean | string;
  excludeServers?: string;
  preferredServer?: string;
}

interface CreateDownloadResult {
  id: string;
  downloadId: string;
  status: DownloadStatus;
  statusUrl: string;
  url: string;
  quality: string;
  variant: EpisodeVariant;
}

interface DownloadSnapshot {
  id: string;
  downloadId: string;
  status: DownloadStatus;
  progress: number;
  url: string;
  quality: string;
  variant: EpisodeVariant;
  downloadUrl: string | null;
  fileSize: string | null;
  sourceUrl: string | null;
  currentServer: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface BatchItemRef {
  episode: number;
  downloadId: string;
  status: DownloadStatus;
}

interface BatchRecord {
  batchId: string;
  animeUrl: string;
  quality: string;
  variant: EpisodeVariant;
  createdAt: number;
  items: BatchItemRef[];
}

interface CreateBatchPayload {
  animeUrl?: string;
  episodes?: unknown[];
  quality?: string;
  variant?: string;
  includeMega?: boolean | string;
  excludeServers?: string;
  preferredServer?: string;
}

interface CreateBatchResult {
  batchId: string;
  status: "queued";
  total: number;
  statusUrl: string;
  items: BatchItemRef[];
}

interface BatchItemSnapshot {
  episode: number;
  downloadId: string;
  status: DownloadStatus;
  progress: number;
  downloadUrl: string | null;
  error: string | null;
}

interface BatchSnapshot {
  batchId: string;
  status: "completed" | "failed" | "downloading";
  progress: number;
  total: number;
  completed: number;
  failed: number;
  items: BatchItemSnapshot[];
}

// ---------------------------------------------------------------------------
// Estado en memoria (proceso único; no persiste entre reinicios)
// ---------------------------------------------------------------------------

const downloadStore = new Map<string, DownloadRecord>();
const batchStore = new Map<string, BatchRecord>();

const DEBUG_MODE = process.env.DEBUG_DOWNLOAD === "true";

function debugLog(server: string, message: string, data?: unknown): void {
  if (!DEBUG_MODE) {
    return;
  }
  const label = `[${server}] ${message}`;
  if (data !== undefined) {
    logger.debug(label, { data: typeof data === "string" ? data.slice(0, 500) : data });
  } else {
    logger.debug(label);
  }
}

const SERVER_PRIORITY = ["yourupload", "pdrain", "1fichier", "mp4upload", "upnshare", "hls", "mega"];

// ---------------------------------------------------------------------------
// Utilidades de sistema de archivos / nombres
// ---------------------------------------------------------------------------

function getDownloadsDir(): string {
  const configuredPath = process.env.DOWNLOADS_DIR || "downloads";
  const targetPath = path.resolve(process.cwd(), configuredPath);
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function safeFilePart(value: unknown): string {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function extractEpisodeNumber(episodeUrl: string | null | undefined): number | null {
  if (!episodeUrl) {
    return null;
  }

  const parts = episodeUrl.split("/").filter(Boolean);
  const lastPart = parts[parts.length - 1] || "";

  const numberMatch = lastPart.match(/(\d+)$/);
  if (numberMatch && numberMatch[1]) {
    return Number(numberMatch[1]);
  }

  return null;
}

function extractAnimeSlug(episodeUrl: string): string {
  const parts = episodeUrl.split("/").filter(Boolean);
  const mediaIndex = parts.findIndex((part) => part === "media");
  if (mediaIndex === -1 || !parts[mediaIndex + 1]) {
    return "anime";
  }
  return safeFilePart(parts[mediaIndex + 1]) || "anime";
}

function getExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname || "";
    const ext = path.extname(pathname).toLowerCase();
    if ([".mp4", ".mkv", ".avi", ".mov", ".webm"].includes(ext)) {
      return ext;
    }
  } catch {
    // Ignorar errores de parseo y usar el valor por defecto.
  }

  return ".mp4";
}

function getRefererForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/`;
  } catch {
    return "https://animeav1.com/";
  }
}

function buildCookieHeader(setCookieHeaders: unknown): string {
  if (!setCookieHeaders) {
    return "";
  }

  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return cookies.map((cookie) => String(cookie).split(";")[0]).join("; ");
}

// ---------------------------------------------------------------------------
// Resolutores de embed que NO están cubiertos por el módulo compartido
// utils/resolvers/resolvers.ts (servidores específicos del motor de descarga).
// El resto (Streamwish, Streamtape, VOE, Hqq/Netu, Vidhide, Mixdrop,
// Doodstream, Dropload, MP4Upload y el fallback con Puppeteer) se delega al
// resolutor compartido para no duplicar lógica ya portada.
// ---------------------------------------------------------------------------

async function resolveOneFichierUrl(url: string, referer?: string | null): Promise<string | null> {
  debugLog("1Fichier", "Resolviendo URL", url);
  try {
    const { html, headers } = await fetchHtmlWithHeaders(url, referer);
    debugLog("1Fichier", "Longitud del HTML obtenido", html.length);

    const simpleMatch = html.match(/https?:\/\/[^\s'"]+\.(?:mp4|mkv|avi|mov|webm|zip|rar)/i);
    if (simpleMatch && simpleMatch[0]) {
      debugLog("1Fichier", "URL directa encontrada en el HTML", simpleMatch[0]);
      return normalizeExtractedUrl(simpleMatch[0]);
    }

    const cookieHeader = buildCookieHeader(headers["set-cookie"]);
    debugLog("1Fichier", "Cookie header", cookieHeader ? "presente" : "ausente");

    const formBody = new URLSearchParams({ dl: "1" }).toString();

    let response: AxiosResponse<string> | null = null;
    try {
      response = await axios.post(url, formBody, {
        timeout: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
        maxRedirects: 0,
        headers: {
          ...HTML_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: referer || url,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debugLog("1Fichier", "Error en POST", message);
      response = null;
    }

    if (response) {
      debugLog("1Fichier", "Status de la respuesta POST", response.status);

      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        debugLog("1Fichier", "Redirigido a", response.headers.location);
        return String(response.headers.location);
      }

      if (typeof response.data === "string") {
        const m = response.data.match(/https?:\/\/[^\s'"]+\.(?:mp4|mkv|avi|mov|webm|zip|rar)/i);
        if (m && m[0]) {
          debugLog("1Fichier", "URL encontrada en la respuesta POST", m[0]);
          return normalizeExtractedUrl(m[0]);
        }
      }
    }

    debugLog("1Fichier", "No se encontro ninguna URL");
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog("1Fichier", "Error", message);
    return null;
  }
}

async function resolveYourUploadUrl(url: string, referer?: string | null): Promise<string | null> {
  debugLog("YourUpload", "Resolviendo URL", url);
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);
    debugLog("YourUpload", "Longitud del HTML obtenido", html.length);

    const extracted = findFirstUrl(html, [
      /file["']?\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
      /video\[[^\]]+\]\s*=\s*["']([^"']+\.mp4[^"']*)["']/i,
    ]);

    if (extracted) {
      debugLog("YourUpload", "URL encontrada", extracted);
      return extracted;
    }

    debugLog("YourUpload", "No se encontro ninguna URL");
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog("YourUpload", "Error", message);
    return null;
  }
}

async function resolveOkruUrl(url: string, referer?: string | null): Promise<string | null> {
  debugLog("Okru", "Resolviendo URL", url);
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Okru", "Longitud del HTML obtenido", html.length);

    const extracted = findFirstUrl(html, [
      /"metadata"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
      /flashvars\s*=\s*\{[^}]*src\s*:\s*"([^"]+)"/i,
      /videoUrl\s*=\s*"([^"]+)"/i,
    ]);

    if (extracted) {
      debugLog("Okru", "URL encontrada", extracted);
      return extracted;
    }

    debugLog("Okru", "No se encontro ninguna URL");
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog("Okru", "Error", message);
    return null;
  }
}

async function resolveFembedUrl(url: string, referer?: string | null): Promise<string | null> {
  debugLog("Fembed", "Resolviendo URL", url);
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Fembed", "Longitud del HTML obtenido", html.length);

    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
      /file["']?\s*:\s*["']([^"']+)["']/i,
      /video\s*=\s*["']([^"']+\.mp4[^"']*)["']/i,
    ]);

    if (extracted) {
      debugLog("Fembed", "URL encontrada", extracted);
      return extracted;
    }

    debugLog("Fembed", "No se encontro ninguna URL");
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog("Fembed", "Error", message);
    return null;
  }
}

async function resolveFilemoonUrl(url: string, referer?: string | null): Promise<string | null> {
  debugLog("Filemoon", "Resolviendo URL", url);
  try {
    const { html } = await fetchHtmlWithHeaders(url, referer);
    debugLog("Filemoon", "Longitud del HTML obtenido", html.length);

    const extracted = findFirstUrl(html, [
      /sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i,
      /file\s*:\s*"([^"\)]+)"/i,
    ]);

    if (extracted) {
      debugLog("Filemoon", "URL encontrada", extracted);
      return extracted;
    }

    debugLog("Filemoon", "No se encontro ninguna URL");
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog("Filemoon", "Error", message);
    return null;
  }
}

function tryDecodeJKPlayerUrl(encodedUrl: string | null): string | null {
  if (!encodedUrl) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedUrl, "base64").toString("utf8");
    const urlMatch = decoded.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1].split("&")[0];
    }

    if (decoded.includes("http")) {
      return decoded.split("&")[0];
    }
  } catch {
    // Ignorar
  }
  return null;
}

async function resolveJKPlayerUrl(url: string, referer?: string | null): Promise<string | null> {
  debugLog("JKPlayer", "Resolviendo URL", url);
  try {
    const parsedUrl = new URL(url);
    const eParam = parsedUrl.searchParams.get("e");

    if (eParam) {
      const decodedUrl = tryDecodeJKPlayerUrl(eParam);
      if (decodedUrl && decodedUrl.startsWith("http")) {
        debugLog("JKPlayer", "URL decodificada", decodedUrl);
        return decodedUrl;
      }
    }

    const { html } = await fetchHtmlWithHeaders(url, referer);
    debugLog("JKPlayer", "Longitud del HTML obtenido", html.length);

    const scriptMatch = html.match(
      /player\.setup\(\{[\s\S]*?sources\s*:\s*\[\s*\{[\s\S]*?file\s*:\s*"([^"]+)"[\s\S]*?\}[\s\S]*?\]\}/
    );
    if (scriptMatch && scriptMatch[1]) {
      return scriptMatch[1];
    }

    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog("JKPlayer", "Error", message);
    return null;
  }
}

/**
 * Convierte un enlace de embed en la URL directa reproducible (.mp4/.m3u8).
 * Primero intenta con los resolutores propios del motor de descarga que no
 * existen en el módulo compartido (1Fichier, YourUpload, Okru, Fembed,
 * JKPlayer, Filemoon) y delega el resto (Streamwish, Streamtape, VOE,
 * Hqq/Netu, Vidhide, Mixdrop, Doodstream, Dropload, MP4Upload y el fallback
 * con Puppeteer) al resolutor compartido `resolveEmbedUrl` de
 * utils/resolvers/resolvers.ts.
 */
async function resolveEmbedUrlForDownload(
  url: string | null,
  record: DownloadRecord,
  candidate: DownloadCandidate
): Promise<string | null> {
  if (!url) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const parentUrl = candidate?.url || record?.url || url;
  const referer = getRefererForUrl(parentUrl);

  debugLog("resolveEmbed", `Host: ${host}, Path: ${pathname}`, url);

  if (/1fichier/i.test(host)) {
    debugLog("resolveEmbed", "Usando resolutor de 1Fichier", null);
    const resolved = await resolveOneFichierUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en 1Fichier");
    return resolved;
  }

  if (/yourupload/i.test(host)) {
    debugLog("resolveEmbed", "Usando resolutor de YourUpload", null);
    const resolved = await resolveYourUploadUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en YourUpload");
    return resolved;
  }

  if (/ok\.ru|okru/i.test(host)) {
    debugLog("resolveEmbed", "Usando resolutor de Okru", null);
    const resolved = await resolveOkruUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en Okru");
    return resolved;
  }

  if (/embedsito|fembed|mycloud/i.test(host)) {
    debugLog("resolveEmbed", "Usando resolutor de Fembed", null);
    const resolved = await resolveFembedUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en Fembed");
    return resolved;
  }

  if (/jkplayers|jkanime/i.test(host) || /\/jkplayer\//.test(pathname)) {
    debugLog("resolveEmbed", "Usando resolutor de JKPlayer", null);
    const resolved = await resolveJKPlayerUrl(url, referer);
    if (!resolved) throw new Error("No se pudo resolver enlace directo en JKPlayer");
    return resolved;
  }

  if (/bysekoze|filemoon/i.test(host)) {
    debugLog("resolveEmbed", "Usando resolutor de Filemoon", null);
    const resolved = await resolveFilemoonUrl(url, referer);
    if (resolved) return resolved;
  }

  debugLog("resolveEmbed", "Delegando al resolutor compartido", null);
  return resolveEmbedUrlShared(url, parentUrl);
}

// ---------------------------------------------------------------------------
// Selección de candidatos y descarga
// ---------------------------------------------------------------------------

function chooseCandidateLinks(
  episodeData: EpisodeLinksData,
  variant: string | undefined,
  preferredServer: string | undefined
): DownloadCandidate[] {
  const normalizedVariant: EpisodeVariant = String(variant || "SUB").toUpperCase() === "DUB" ? "DUB" : "SUB";
  const otherVariant: EpisodeVariant = normalizedVariant === "SUB" ? "DUB" : "SUB";

  const downloadLinks = episodeData.downloadLinks || { SUB: [], DUB: [] };
  const streamLinks = episodeData.streamLinks || { SUB: [], DUB: [] };

  const candidates: VideoLink[] = [
    ...(downloadLinks[normalizedVariant] || []),
    ...(downloadLinks[otherVariant] || []),
    ...(streamLinks[normalizedVariant] || []),
    ...(streamLinks[otherVariant] || []),
  ];

  const seen = new Set<string>();
  const deduped: DownloadCandidate[] = [];

  for (const item of candidates) {
    if (!item || typeof item.url !== "string" || !item.url.trim()) {
      continue;
    }

    const key = item.url.trim();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      server: item.server || "Unknown",
      url: key,
      quality: item.quality || null,
    });
  }

  const preferredToken = safeFilePart(preferredServer);

  deduped.sort((a, b) => {
    const serverA = safeFilePart(a.server);
    const serverB = safeFilePart(b.server);

    const preferredBonusA = preferredToken && serverA.includes(preferredToken) ? -100 : 0;
    const preferredBonusB = preferredToken && serverB.includes(preferredToken) ? -100 : 0;

    const priorityA = SERVER_PRIORITY.findIndex((token) => serverA.includes(token));
    const priorityB = SERVER_PRIORITY.findIndex((token) => serverB.includes(token));
    const resolvedA = priorityA === -1 ? 999 : priorityA;
    const resolvedB = priorityB === -1 ? 999 : priorityB;

    return resolvedA + preferredBonusA - (resolvedB + preferredBonusB);
  });

  return deduped;
}

function makeDownloadFilename(record: DownloadRecord, sourceUrl: string, serverName: string): string {
  const slug = extractAnimeSlug(record.url);
  const episodeNumber = extractEpisodeNumber(record.url);
  const ext = getExtensionFromUrl(sourceUrl);
  const serverToken = safeFilePart(serverName || "server");
  const qualityToken = safeFilePart(record.quality || "auto");
  const suffix = record.downloadId.split("-")[0];
  const episodeLabel = Number.isFinite(episodeNumber) ? `ep${episodeNumber}` : "epx";

  return `${slug}-${episodeLabel}-${qualityToken}-${serverToken}-${suffix}${ext}`;
}

async function removeFileIfExists(targetPath: string): Promise<void> {
  try {
    await fs.promises.unlink(targetPath);
  } catch {
    // Ignorar archivos inexistentes.
  }
}

function ensureDirectLikeContent(contentType: string | undefined, url: string): void {
  const lowered = (contentType || "").toLowerCase();
  if (/(text\/html|application\/json|application\/javascript|text\/plain)/i.test(lowered)) {
    throw new Error(`El servidor devolvio contenido no descargable (${lowered || "desconocido"}) para ${url}`);
  }
}

function resolveDirectDownloadUrl(rawUrl: string, serverName: string | null): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const serverToken = safeFilePart(serverName || "");

  if (host.includes("pixeldrain.com") || serverToken.includes("pdrain") || serverToken.includes("pixeldrain")) {
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const isFileApi = pathParts[0] === "api" && pathParts[1] === "file" && pathParts[2];
    const isUserShare = pathParts[0] === "u" && pathParts[1];

    const fileId = isFileApi ? pathParts[2] : isUserShare ? pathParts[1] : null;
    if (fileId) {
      return `https://pixeldrain.com/api/file/${fileId}?download`;
    }
  }

  if (host.includes("zilla-networks.com") && parsed.pathname.startsWith("/play/")) {
    const videoId = parsed.pathname.split("/").pop();
    if (videoId) {
      return `https://player.zilla-networks.com/m3u8/${videoId}`;
    }
  }

  return rawUrl;
}

interface FfmpegProgressEvent {
  percent?: number;
}

async function downloadHlsVideo(
  finalUrl: string,
  filePath: string,
  record: DownloadRecord,
  candidate: DownloadCandidate
): Promise<void> {
  record.status = "downloading";
  record.currentServer = candidate.server;
  record.sourceUrl = finalUrl;
  record.totalBytes = null;
  record.downloadedBytes = 0;
  record.progress = 1;
  record.updatedAt = Date.now();

  const referer = getRefererForUrl(candidate.url || record.url || finalUrl);

  return new Promise<void>((resolve, reject) => {
    ffmpeg(finalUrl)
      .inputOptions([
        "-headers",
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36\r\nReferer: ${referer}\r\n`,
      ])
      .outputOptions(["-c copy", "-bsf:a aac_adtstoasc"])
      .output(filePath)
      .on("start", () => {
        record.status = "downloading";
        record.progress = 1;
        record.updatedAt = Date.now();
      })
      .on("progress", (progress: FfmpegProgressEvent) => {
        if (progress.percent && progress.percent > 0) {
          record.progress = Math.max(1, Math.min(99, Math.floor(progress.percent)));
        } else {
          // Si ffmpeg no nos da un %, subimos el progreso visualmente poco a poco
          record.progress = Math.min(90, record.progress + 1);
        }
        record.updatedAt = Date.now();
      })
      .on("error", async (err: Error) => {
        await removeFileIfExists(filePath);
        reject(new Error(`Transferencia fallida en ${candidate.server} (HLS): ${err.message}`));
      })
      .on("end", () => {
        resolve();
      })
      .run();
  });
}

async function downloadFromUrl(record: DownloadRecord, candidate: DownloadCandidate): Promise<void> {
  let finalUrl: string | null = resolveDirectDownloadUrl(candidate.url, candidate.server);
  finalUrl = await resolveEmbedUrlForDownload(finalUrl, record, candidate);
  if (!finalUrl) {
    throw new Error(`No se pudo resolver enlace directo en ${candidate.server}`);
  }

  const downloadsDir = getDownloadsDir();
  const fileName = makeDownloadFilename(record, finalUrl, candidate.server);
  const filePath = path.join(downloadsDir, fileName);

  const referer = getRefererForUrl(candidate.url || record.url || finalUrl);

  const isHls = finalUrl.toLowerCase().includes(".m3u8") || /hls/i.test(candidate.server);

  if (isHls) {
    await downloadHlsVideo(finalUrl, filePath, record, candidate);
  } else {
    let response;
    try {
      const timeout = Number(process.env.DOWNLOAD_REQUEST_TIMEOUT_MS || 120000);
      response = await axios.get(finalUrl, {
        responseType: "stream",
        timeout,
        maxRedirects: 5,
        headers: {
          ...DEFAULT_HEADERS,
          Referer: referer,
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo abrir enlace ${candidate.server}: ${message}`);
    }

    const contentType = String(response.headers["content-type"] ?? "");
    ensureDirectLikeContent(contentType, finalUrl);

    const totalBytesRaw = Number(response.headers["content-length"] || 0);
    const totalBytes = Number.isFinite(totalBytesRaw) && totalBytesRaw > 0 ? totalBytesRaw : null;

    record.status = "downloading";
    record.currentServer = candidate.server;
    record.sourceUrl = finalUrl;
    record.totalBytes = totalBytes;
    record.downloadedBytes = 0;
    record.progress = 1;
    record.updatedAt = Date.now();

    const writer = fs.createWriteStream(filePath, { flags: "w" });

    response.data.on("data", (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) {
        return;
      }

      record.downloadedBytes += chunk.length;
      record.updatedAt = Date.now();

      if (record.totalBytes && record.totalBytes > 0) {
        const pct = Math.floor((record.downloadedBytes / record.totalBytes) * 100);
        record.progress = Math.max(1, Math.min(99, pct));
        return;
      }

      record.progress = Math.min(90, record.progress + 1);
    });

    try {
      await pipeline(response.data, writer);
    } catch (error) {
      await removeFileIfExists(filePath);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Transferencia fallida en ${candidate.server}: ${message}`);
    }
  }

  const stat = await fs.promises.stat(filePath);
  if (!stat.size || stat.size < 512 * 1024) {
    await removeFileIfExists(filePath);
    throw new Error(`Archivo invalido en ${candidate.server}: tamano demasiado pequeno`);
  }

  record.status = "completed";
  record.progress = 100;
  record.fileName = fileName;
  record.filePath = filePath;
  record.fileSize = String(stat.size);
  record.downloadUrl = `${record.baseUrl}/downloads/${fileName}`;
  record.completedAt = Date.now();
  record.error = null;
}

async function runDownload(record: DownloadRecord, payload: CreateDownloadPayload): Promise<void> {
  record.status = "preparing";
  record.updatedAt = Date.now();

  const variant: EpisodeVariant = String(record.variant || "SUB").toUpperCase() === "DUB" ? "DUB" : "SUB";
  const includeMega = String(payload?.includeMega).toLowerCase() === "true";
  const excludeServers = payload?.excludeServers;
  const preferredServer = payload?.preferredServer;

  try {
    const episodeResponse: ProviderResponse<EpisodeLinksData> = await animeService.getEpisodeLinks(
      record.url,
      includeMega,
      excludeServers
    );
    const candidates = chooseCandidateLinks(episodeResponse.data, variant, preferredServer);

    if (candidates.length === 0) {
      throw new Error("No se encontraron enlaces para descarga real");
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        await downloadFromUrl(record, candidate);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.server}: ${message}`);
      }
    }

    throw new Error(`Todos los servidores fallaron. ${errors.join(" | ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido en descarga";
    record.status = "failed";
    record.progress = 0;
    record.error = message;
    record.updatedAt = Date.now();
  }
}

// ---------------------------------------------------------------------------
// API pública del servicio (usada por las rutas de descarga)
// ---------------------------------------------------------------------------

export function createDownload(payload: CreateDownloadPayload, baseUrl: string): CreateDownloadResult {
  if (!payload || typeof payload.url !== "string" || !payload.url.trim()) {
    throw ApiError.badRequest("Se requiere el parametro url en el body");
  }

  const downloadId = randomUUID();
  const variant: EpisodeVariant = String(payload.variant || "SUB").toUpperCase() === "DUB" ? "DUB" : "SUB";
  const record: DownloadRecord = {
    downloadId,
    status: "queued",
    progress: 0,
    url: payload.url.trim(),
    quality: payload.quality || "1080p",
    variant,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    baseUrl,
    error: null,
    downloadUrl: null,
    fileSize: null,
    fileName: null,
    filePath: null,
    downloadedBytes: 0,
    totalBytes: null,
    sourceUrl: null,
    currentServer: null,
    completedAt: null,
  };

  downloadStore.set(downloadId, record);

  void runDownload(record, payload);

  return {
    id: downloadId,
    downloadId,
    status: record.status,
    statusUrl: `/api/v1/anime/download/${downloadId}`,
    url: record.url,
    quality: record.quality,
    variant: record.variant,
  };
}

export function getDownload(downloadId: string): DownloadSnapshot {
  const record = downloadStore.get(downloadId);
  if (!record) {
    throw ApiError.notFound("Descarga no encontrada");
  }

  return {
    id: record.downloadId,
    downloadId: record.downloadId,
    status: record.status,
    progress: record.progress,
    url: record.url,
    quality: record.quality,
    variant: record.variant,
    downloadUrl: record.downloadUrl,
    fileSize: record.fileSize,
    sourceUrl: record.sourceUrl,
    currentServer: record.currentServer,
    downloadedBytes: record.downloadedBytes,
    totalBytes: record.totalBytes,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt || null,
  };
}

export function createBatch(payload: CreateBatchPayload, baseUrl: string): CreateBatchResult {
  const animeUrl = (payload?.animeUrl || "").toString().trim();
  const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];

  if (!animeUrl) {
    throw ApiError.badRequest("Se requiere animeUrl en el body");
  }

  if (episodes.length === 0) {
    throw ApiError.badRequest("Se requiere un arreglo de episodes con al menos un elemento");
  }

  const normalizedEpisodes = episodes
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);

  if (normalizedEpisodes.length === 0) {
    throw ApiError.badRequest("episodes debe contener numeros de episodio validos");
  }

  const batchId = randomUUID();
  const variant: EpisodeVariant = String(payload.variant || "SUB").toUpperCase() === "DUB" ? "DUB" : "SUB";
  const quality = payload.quality || "1080p";

  const entries: BatchItemRef[] = normalizedEpisodes.map((episodeNumber) => {
    const episodeUrl = `${animeUrl.replace(/\/$/, "")}/${episodeNumber}`;
    const created = createDownload(
      {
        url: episodeUrl,
        quality,
        variant,
        includeMega: payload.includeMega,
        excludeServers: payload.excludeServers,
        preferredServer: payload.preferredServer,
      },
      baseUrl
    );

    return {
      episode: episodeNumber,
      downloadId: created.downloadId,
      status: created.status,
    };
  });

  const batch: BatchRecord = {
    batchId,
    animeUrl,
    quality,
    variant,
    createdAt: Date.now(),
    items: entries,
  };

  batchStore.set(batchId, batch);

  return {
    batchId,
    status: "queued",
    total: entries.length,
    statusUrl: `/api/v1/anime/batch/${batchId}`,
    items: entries,
  };
}

export function getBatch(batchId: string): BatchSnapshot {
  const batch = batchStore.get(batchId);
  if (!batch) {
    throw ApiError.notFound("Batch no encontrado");
  }

  const items: BatchItemSnapshot[] = batch.items.map((item) => {
    const snapshot = getDownload(item.downloadId);
    return {
      episode: item.episode,
      downloadId: item.downloadId,
      status: snapshot.status,
      progress: snapshot.progress,
      downloadUrl: snapshot.downloadUrl,
      error: snapshot.error,
    };
  });

  const total = items.length;
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    batchId,
    status: completed === total ? "completed" : failed === total ? "failed" : "downloading",
    progress,
    total,
    completed,
    failed,
    items,
  };
}

export { getDownloadsDir };
