import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../utils/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function extractAccessToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  const cookieToken = req.cookies?.accessToken;
  return typeof cookieToken === "string" ? cookieToken : null;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  if (!token) {
    return next(ApiError.unauthorized("No autenticado: falta el token de acceso"));
  }

  const payload = verifyAccessToken(token);
  req.userId = payload.sub;
  next();
}

/**
 * Igual que `authenticate`, pero no falla si no hay token: lo usan rutas
 * públicas (perfil público, ratings) que necesitan saber "¿quién pregunta?"
 * para decidir qué mostrar (ej. el dueño del perfil ve su propio contenido
 * privado) sin exigir sesión a cualquier visitante anónimo.
 */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
  } catch {
    // Token inválido/expirado: se sigue como anónimo en vez de fallar.
  }
  next();
}
