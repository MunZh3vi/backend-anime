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
