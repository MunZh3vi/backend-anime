import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../utils/jwt";
import { prisma } from "../config/prisma";
import type { Role } from "@prisma/client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: Role;
      matureContentEnabled?: boolean;
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

// Express 4 no espera el resultado de un middleware async: los errores se
// manejan a mano acá adentro con next(err) en vez de dejar que throw escape.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  if (!token) {
    return next(ApiError.unauthorized("No autenticado: falta el token de acceso"));
  }

  try {
    const payload = verifyAccessToken(token);

    // Chequeo de baneo en cada request autenticado: un access token válido
    // (hasta 15 min) no debe seguir funcionando si banearon a la cuenta en
    // el medio.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { bannedAt: true, banReason: true, role: true, matureContentEnabled: true },
    });

    if (!user) return next(ApiError.unauthorized("Usuario no encontrado"));
    if (user.bannedAt) {
      return next(ApiError.forbidden(`Tu cuenta fue suspendida${user.banReason ? `: ${user.banReason}` : ""}`));
    }

    req.userId = payload.sub;
    req.userRole = user.role;
    req.matureContentEnabled = user.matureContentEnabled;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Igual que `authenticate`, pero no falla si no hay token: lo usan rutas
 * públicas (perfil público, ratings) que necesitan saber "¿quién pregunta?"
 * para decidir qué mostrar (ej. el dueño del perfil ve su propio contenido
 * privado) sin exigir sesión a cualquier visitante anónimo.
 */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractAccessToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { bannedAt: true, role: true, matureContentEnabled: true },
    });
    if (user && !user.bannedAt) {
      req.userId = payload.sub;
      req.userRole = user.role;
      req.matureContentEnabled = user.matureContentEnabled;
    }
  } catch {
    // Token inválido/expirado: se sigue como anónimo en vez de fallar.
  }
  next();
}

/** Requiere que `authenticate` ya haya corrido antes en la cadena. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return next(ApiError.forbidden("No tenés permiso para esta acción"));
    }
    next();
  };
}
