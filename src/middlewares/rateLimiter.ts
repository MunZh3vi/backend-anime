import rateLimit from "express-rate-limit";
import { Request, Response } from "express";
import { env } from "../config/env";
import { sendError } from "../utils/response";

export const rateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Demasiadas peticiones, intenta de nuevo en un momento");
  },
});
