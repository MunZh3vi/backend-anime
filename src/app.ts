import path from "node:path";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { corsMiddleware } from "./middlewares/corsConfig";
import { rateLimiter } from "./middlewares/rateLimiter";
import { requestLogger } from "./middlewares/requestLogger";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { apiV1Router } from "./routes";
import { swaggerSpec } from "./docs/swagger";
import { getDownloadsDir } from "./services/download.service";

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(corsMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use("/api", rateLimiter);

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));

// Sirve los episodios descargados a disco por download.service.ts.
app.use(
  "/downloads",
  express.static(getDownloadsDir(), {
    index: false,
    fallthrough: false,
    setHeaders: (res, filePath) => {
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    },
  })
);

app.use("/api/v1", apiV1Router);

app.use(notFoundHandler);
app.use(errorHandler);
