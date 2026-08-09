import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import { sendError } from "../utils/response";

// Evita flood de comentarios: el rate-limit general (100/min por IP) es
// demasiado laxo para esto, ya que cubre TODA la API, no solo comentarios.
export const commentRateLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  // Por usuario autenticado en vez de por IP: varios usuarios detrás del
  // mismo NAT/proxy no deberían compartir el mismo límite.
  keyGenerator: (req: Request) => req.userId || req.ip || "anonymous",
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Estás comentando muy rápido, esperá un momento");
  },
});
