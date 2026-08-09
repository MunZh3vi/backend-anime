import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { env } from "./env";

export const sentryEnabled = Boolean(env.sentryDsn);

/** No-op si SENTRY_DSN no está definida: no hace falta cuenta/DSN para correr el backend. */
export function initSentry(): void {
  if (!sentryEnabled) return;

  Sentry.init({
    dsn: env.sentryDsn!,
    environment: env.nodeEnv,
    tracesSampleRate: 0.1,
  });
}

/** Debe llamarse después de montar las rutas y antes del errorHandler propio. */
export function attachSentryErrorHandler(app: Express): void {
  if (!sentryEnabled) return;
  Sentry.setupExpressErrorHandler(app);
}
