import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "./ApiError";

export interface AccessTokenPayload {
  sub: string; // userId
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, env.accessTokenSecret, {
    expiresIn: env.accessTokenExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.accessTokenSecret);
    if (typeof decoded === "string" || !decoded.sub) {
      throw new Error("Token sin subject");
    }
    return { sub: String(decoded.sub) };
  } catch {
    throw ApiError.unauthorized("Token de acceso inválido o expirado");
  }
}

const TWO_FACTOR_PURPOSE = "2fa-challenge";

/**
 * Token de vida corta emitido tras validar email+password cuando el usuario
 * tiene 2FA activo: no sirve para nada más que completar el segundo paso
 * del login (POST /auth/login/2fa). Usa el mismo secreto que el access
 * token pero con un claim de propósito distinto para que no se confundan.
 */
export function signTwoFactorChallengeToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: TWO_FACTOR_PURPOSE }, env.accessTokenSecret, { expiresIn: "5m" });
}

export function verifyTwoFactorChallengeToken(token: string): { sub: string } {
  try {
    const decoded = jwt.verify(token, env.accessTokenSecret);
    if (typeof decoded === "string" || decoded.purpose !== TWO_FACTOR_PURPOSE || !decoded.sub) {
      throw new Error("Token inválido");
    }
    return { sub: String(decoded.sub) };
  } catch {
    throw ApiError.unauthorized("Token de verificación en dos pasos inválido o expirado");
  }
}
