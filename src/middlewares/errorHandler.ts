import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { sendError } from "../utils/response";
import { logger } from "../utils/logger";
import { isProd } from "../config/env";

export function notFoundHandler(req: Request, res: Response) {
  sendError(res, 404, `Ruta no encontrada: ${req.method} ${req.originalUrl}`);
}

// Firma de 4 argumentos requerida por Express para reconocerlo como error handler.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { path: req.originalUrl, stack: err.stack, details: err.details });
    }
    return sendError(res, err.statusCode, err.message, isProd ? undefined : err.details);
  }

  const message = err instanceof Error ? err.message : "Error interno del servidor";
  logger.error(message, { path: req.originalUrl, err });
  return sendError(res, 500, "Error interno del servidor");
}
