import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { verifyPassword } from "../utils/password";

const ISSUER = "Anime Backend";

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/**
 * Genera un secreto nuevo pero NO lo guarda todavía: recién se persiste en
 * `enableTwoFactor` una vez que el usuario prueba que efectivamente lo
 * configuró bien (mandando un código válido). Evita dejar a alguien con
 * "2FA a medias" si nunca completa el segundo paso.
 */
export async function setupTwoFactor(userId: string): Promise<TwoFactorSetup> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("Usuario no encontrado");

  const secret = generateSecret();
  const otpauthUrl = generateURI({ issuer: ISSUER, label: user.email, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { secret, otpauthUrl, qrCodeDataUrl };
}

export async function enableTwoFactor(userId: string, secret: string, code: string): Promise<void> {
  const { valid } = await verify({ secret, token: code });
  if (!valid) throw ApiError.badRequest("Código incorrecto");

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true, twoFactorSecret: secret },
  });
}

export async function disableTwoFactor(userId: string, password: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("Usuario no encontrado");
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw ApiError.badRequest("No tenés 2FA activado");
  }

  const validPassword = await verifyPassword(password, user.passwordHash);
  if (!validPassword) throw ApiError.unauthorized("Contraseña incorrecta");

  const { valid: validCode } = await verify({ secret: user.twoFactorSecret, token: code });
  if (!validCode) throw ApiError.badRequest("Código incorrecto");

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
}
