import { Request, Response } from "express";
import * as userService from "../services/user.service";
import { sendSuccess } from "../utils/response";
import { ApiError } from "../utils/ApiError";
import {
  UpdateProfileInput,
  ChangePasswordInput,
  DeleteAccountInput,
  ChangeEmailInput,
} from "../validators/user.validators";

export async function getProfile(req: Request, res: Response) {
  const profile = await userService.getProfile(req.userId!);
  sendSuccess(res, profile);
}

export async function updateProfile(req: Request, res: Response) {
  const input = req.body as UpdateProfileInput;
  const profile = await userService.updateProfile(req.userId!, input);
  sendSuccess(res, profile);
}

export async function changeEmail(req: Request, res: Response) {
  const input = req.body as ChangeEmailInput;
  const profile = await userService.changeEmail(req.userId!, input);
  sendSuccess(res, profile);
}

export async function changePassword(req: Request, res: Response) {
  const input = req.body as ChangePasswordInput;
  await userService.changePassword(req.userId!, input);
  sendSuccess(res, { message: "Contraseña actualizada, vuelve a iniciar sesión" });
}

export async function deleteAccount(req: Request, res: Response) {
  const input = req.body as DeleteAccountInput;
  await userService.deleteAccount(req.userId!, input.password);
  sendSuccess(res, { message: "Cuenta eliminada" });
}

export async function listSessions(req: Request, res: Response) {
  const currentRefreshToken = req.cookies?.refreshToken;
  const sessions = await userService.listSessions(req.userId!, currentRefreshToken);
  sendSuccess(res, { sessions, total: sessions.length });
}

export async function revokeSession(req: Request, res: Response) {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest("id es requerido");
  await userService.revokeSession(req.userId!, id);
  sendSuccess(res, { message: "Sesión cerrada" });
}

export async function revokeOtherSessions(req: Request, res: Response) {
  const currentRefreshToken = req.cookies?.refreshToken;
  await userService.revokeOtherSessions(req.userId!, currentRefreshToken);
  sendSuccess(res, { message: "Se cerraron las demás sesiones" });
}
