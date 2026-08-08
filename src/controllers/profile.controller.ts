import { Request, Response } from "express";
import * as userService from "../services/user.service";
import { sendSuccess } from "../utils/response";
import { UpdateProfileInput, ChangePasswordInput, DeleteAccountInput } from "../validators/user.validators";

export async function getProfile(req: Request, res: Response) {
  const profile = await userService.getProfile(req.userId!);
  sendSuccess(res, profile);
}

export async function updateProfile(req: Request, res: Response) {
  const input = req.body as UpdateProfileInput;
  const profile = await userService.updateProfile(req.userId!, input);
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
