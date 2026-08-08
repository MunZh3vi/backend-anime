import { Request, Response } from "express";
import * as authService from "../services/auth.service";
import { sendSuccess } from "../utils/response";
import { setAuthCookies, clearAuthCookies } from "../utils/authCookies";
import { ApiError } from "../utils/ApiError";
import { LoginInput, RegisterInput } from "../validators/auth.validators";

export async function register(req: Request, res: Response) {
  const input = req.body as RegisterInput;
  const result = await authService.register(input);
  setAuthCookies(res, result.accessToken, result.refreshToken);
  sendSuccess(res, { user: result.user, accessToken: result.accessToken }, 201);
}

export async function login(req: Request, res: Response) {
  const input = req.body as LoginInput;
  const result = await authService.login(input);
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

  const tokens = await authService.refresh(refreshToken);
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
  sendSuccess(res, { accessToken: tokens.accessToken });
}

export async function verifyEmail(req: Request, res: Response) {
  const { token } = req.query as { token: string };
  await authService.verifyEmail(token);
  sendSuccess(res, { message: "Email verificado correctamente" });
}
