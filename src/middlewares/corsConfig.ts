import cors from "cors";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export const corsMiddleware = cors({
  origin(origin, callback) {
    // Sin header Origin (curl, apps móviles, server-to-server) -> permitir.
    if (!origin) return callback(null, true);

    if (env.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.warn(`CORS bloqueado para origin: ${origin}`);
    return callback(new Error("No permitido por CORS"));
  },
  methods: ["GET", "OPTIONS"],
});
