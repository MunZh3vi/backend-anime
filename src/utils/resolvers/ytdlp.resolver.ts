import { execFile } from "node:child_process";
import { logger } from "../logger";

const YTDLP_ENABLED = process.env.YTDLP_ENABLED !== "false";
const YTDLP_TIMEOUT = Number(process.env.YTDLP_TIMEOUT_MS) || 8500;

let available = false;
let checked = false;

export function isYtdlpAvailable(): boolean {
  return available;
}

function execYtdlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      args,
      { timeout: YTDLP_TIMEOUT, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export async function checkYtdlpAvailability(): Promise<boolean> {
  if (!YTDLP_ENABLED) {
    available = false;
    checked = true;
    return false;
  }

  try {
    const { stdout, stderr } = await execYtdlp(["--version"]);
    const version = (stdout || stderr || "").trim();
    available = Boolean(version);
    if (available) {
      logger.info(`[YTDLP] Detectado version: ${version}`);
    }
  } catch (err) {
    logger.debug("[YTDLP] No disponible en el sistema", { err });
    available = false;
  }

  checked = true;
  return available;
}

export async function extractWithYtdlp(url: string, referer?: string | null): Promise<string | null> {
  if (!YTDLP_ENABLED) return null;
  if (!checked) await checkYtdlpAvailability();
  if (!available) return null;

  try {
    const args = [
      "-g",
      "--flat-playlist",
      "--no-check-certificates",
      "--socket-timeout",
      "8",
      "--referer",
      referer || url,
      url,
    ];

    const { stdout } = await execYtdlp(args);
    const lines = stdout
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("http") && (line.includes(".m3u8") || line.includes(".mp4"))) {
        return line;
      }
    }

    if (lines.length > 0 && lines[0].startsWith("http")) {
      return lines[0];
    }

    return null;
  } catch (err) {
    logger.debug("[YTDLP] Error ejecutando yt-dlp", { err });
    return null;
  }
}
