import { randomBytes, createHash } from "node:crypto";

/**
 * El refresh token es un valor opaco de alta entropía (no un JWT): se guarda
 * en la cookie tal cual, pero en la base de datos solo se persiste su hash
 * SHA-256. Así, un dump de la base no permite reconstruir tokens válidos, y
 * revocar/rotar es tan simple como borrar o marcar la fila.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
