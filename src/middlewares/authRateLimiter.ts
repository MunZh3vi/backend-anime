import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import { sendError } from "../utils/response";

// Más estricto que el rate-limit general: protege login/registro/refresh
// contra fuerza bruta y abuso de creación de cuentas.
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Demasiados intentos, intenta de nuevo en un minuto");
  },
});
