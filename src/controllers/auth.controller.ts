import { Request, Response } from "express";
import * as authService from "../services/auth.service";
import { sendSuccess } from "../utils/response";
import { setAuthCookies, clearAuthCookies } from "../utils/authCookies";
import { ApiError } from "../utils/ApiError";
import { LoginInput, RegisterInput, TwoFactorLoginInput } from "../validators/auth.validators";
import type { DeviceMeta } from "../services/auth.service";

function deviceFrom(req: Request): DeviceMeta {
  return { userAgent: req.header("user-agent") ?? null, ipAddress: req.ip ?? null };
}

export async function register(req: Request, res: Response) {
  const input = req.body as RegisterInput;
  const result = await authService.register(input, deviceFrom(req));
  setAuthCookies(res, result.accessToken, result.refreshToken);
  sendSuccess(res, { user: result.user, accessToken: result.accessToken }, 201);
}

export async function login(req: Request, res: Response) {
  const input = req.body as LoginInput;
  const result = await authService.login(input, deviceFrom(req));

  if ("twoFactorRequired" in result) {
    return sendSuccess(res, { twoFactorRequired: true, challengeToken: result.challengeToken });
  }

  setAuthCookies(res, result.accessToken, result.refreshToken);
  sendSuccess(res, { user: result.user, accessToken: result.accessToken });
}

export async function loginTwoFactor(req: Request, res: Response) {
  const input = req.body as TwoFactorLoginInput;
  const result = await authService.completeTwoFactorLogin(input.challengeToken, input.code, deviceFrom(req));
  setAuthCookies(res, result.accessToken, result.refreshToken);
  sendSuccess(res, { user: result.user, accessToken: result.accessToken });
}

export async function logout(req: Request, res: Response) {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  await authService.logout(refreshToken);
  clearAuthCookies(res);
  sendSuccess(res, { message: "Sesión cerrada" });
}

export async function refreshTokenHandler(req: Request, res: Response) {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!refreshToken) {
    throw ApiError.unauthorized("No se encontró el refresh token");
  }

  const tokens = await authService.refresh(refreshToken, deviceFrom(req));
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
  sendSuccess(res, { accessToken: tokens.accessToken });
}

export async function verifyEmail(req: Request, res: Response) {
  const { token } = req.query as { token: string };
  await authService.verifyEmail(token);
  sendSuccess(res, { message: "Email verificado correctamente" });
}
