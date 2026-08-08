import { Response } from "express";
import { env, isProd } from "../config/env";

const COOKIE_BASE = {
  httpOnly: true,
  secure: isProd,
  // "none" es necesario para cookies cross-site (frontend y backend en dominios
  // distintos, ej. Vercel + Railway). En dev sin HTTPS, "lax" es lo único viable.
  sameSite: (isProd ? "none" : "lax") as "none" | "lax",
  path: "/",
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie("accessToken", accessToken, {
    ...COOKIE_BASE,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshToken, {
    ...COOKIE_BASE,
    maxAge: env.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie("accessToken", COOKIE_BASE);
  res.clearCookie("refreshToken", COOKIE_BASE);
}
