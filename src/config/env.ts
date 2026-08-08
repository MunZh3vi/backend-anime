import dotenv from "dotenv";

dotenv.config();

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 4000),
  logLevel: process.env.LOG_LEVEL ?? "debug",

  allowedOrigins: list(process.env.ALLOWED_ORIGINS) ?? [],

  httpTimeoutMs: num(process.env.HTTP_TIMEOUT_MS, 10_000),

  cacheTtlCatalog: num(process.env.CACHE_TTL_CATALOG, 3600),
  cacheTtlEpisode: num(process.env.CACHE_TTL_EPISODE, 600),

  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax: num(process.env.RATE_LIMIT_MAX, 100),

  imageProxyAllowedHosts: list(process.env.IMAGE_PROXY_ALLOWED_HOSTS),

  accessTokenSecret: resolveSecret("ACCESS_TOKEN_SECRET"),
  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN ?? "15m",
  refreshTokenExpiresInDays: num(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS, 30),
  bcryptSaltRounds: num(process.env.BCRYPT_SALT_ROUNDS, 12),

  imageProxySecret: resolveSecret("IMAGE_PROXY_SECRET"),
} as const;

export const isProd = env.nodeEnv === "production";

function resolveSecret(name: string): string {
  const value = process.env[name];
  if (value && value.length >= 16) return value;

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} debe estar definida (>=16 caracteres) en producción`);
  }

  // eslint-disable-next-line no-console
  console.warn(`[env] ${name} no definida, usando secreto de desarrollo inseguro. No usar en producción.`);
  return "dev-insecure-secret-do-not-use-in-prod";
}
