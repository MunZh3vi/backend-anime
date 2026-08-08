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
