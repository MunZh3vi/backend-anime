import { Request, Response } from "express";
import * as twoFactorService from "../services/twoFactor.service";
import { sendSuccess } from "../utils/response";
import { DisableTwoFactorInput, EnableTwoFactorInput } from "../validators/twoFactor.validators";

export async function setup(req: Request, res: Response) {
  const result = await twoFactorService.setupTwoFactor(req.userId!);
  sendSuccess(res, result);
}

export async function enable(req: Request, res: Response) {
  const input = req.body as EnableTwoFactorInput;
  await twoFactorService.enableTwoFactor(req.userId!, input.secret, input.code);
  sendSuccess(res, { message: "Verificación en dos pasos activada" });
}

export async function disable(req: Request, res: Response) {
  const input = req.body as DisableTwoFactorInput;
  await twoFactorService.disableTwoFactor(req.userId!, input.password, input.code);
  sendSuccess(res, { message: "Verificación en dos pasos desactivada" });
}
