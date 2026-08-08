import path from "node:path";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { corsMiddleware } from "./middlewares/corsConfig";
import { rateLimiter } from "./middlewares/rateLimiter";
import { requestLogger } from "./middlewares/requestLogger";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { apiV1Router } from "./routes";
import { authRouter } from "./routes/auth.routes";
import { userRouter } from "./routes/user.routes";
import { publicUsersRouter } from "./routes/publicUsers.routes";
import { commentRouter } from "./routes/comment.routes";
import { ratingRouter } from "./routes/rating.routes";
import { swaggerSpec } from "./docs/swagger";
import { getDownloadsDir } from "./services/download.service";

export const app = express();

// Railway (y la mayoría de PaaS) corren la app detrás de un único proxy
// inverso que setea X-Forwarded-For. Sin esto, express-rate-limit rechaza
// las requests con ERR_ERL_UNEXPECTED_X_FORWARDED_FOR por posible IP-spoofing.
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(corsMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
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
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/users", publicUsersRouter);
app.use("/api/comments", commentRouter);
app.use("/api/ratings", ratingRouter);

app.use(notFoundHandler);
app.use(errorHandler);
