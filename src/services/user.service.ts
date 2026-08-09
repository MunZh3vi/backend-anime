import { randomBytes } from "node:crypto";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { hashPassword, verifyPassword } from "../utils/password";
import { hashRefreshToken } from "../utils/refreshToken";
import { PublicUser, toPublicUser } from "./auth.service";
import type { ChangeEmailInput, ChangePasswordInput, UpdateProfileInput } from "../validators/user.validators";

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("Usuario no encontrado");
  return toPublicUser(user);
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
  if (input.username) {
    const existing = await prisma.user.findFirst({
      where: { username: input.username, NOT: { id: userId } },
    });
    if (existing) throw ApiError.conflict("Ese nombre de usuario ya está en uso");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      username: input.username,
      avatarUrl: input.avatarUrl,
      bio: input.bio,
      profileVisibility: input.profileVisibility,
      matureContentEnabled: input.matureContentEnabled,
    },
  });

  return toPublicUser(user);
}

export async function changeEmail(userId: string, input: ChangeEmailInput): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("Usuario no encontrado");

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("Contraseña incorrecta");

  if (input.newEmail === user.email) {
    throw ApiError.badRequest("Ese ya es tu email actual");
  }

  const existing = await prisma.user.findUnique({ where: { email: input.newEmail } });
  if (existing) throw ApiError.conflict("Ese email ya está en uso");

  const emailVerificationToken = randomBytes(32).toString("hex");
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      email: input.newEmail,
      // Cambiar el email exige re-verificarlo: no se puede asumir que el
      // dueño de la cuenta también sea dueño de la casilla nueva.
      isEmailVerified: false,
      emailVerificationToken,
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  logger.info(`Verificación de email para ${updated.email}: token=${emailVerificationToken}`);

  return toPublicUser(updated);
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("Usuario no encontrado");

  const valid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("La contraseña actual es incorrecta");

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Cerrar todas las sesiones existentes: un cambio de contraseña debe
  // invalidar refresh tokens emitidos previamente.
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("Usuario no encontrado");

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("Contraseña incorrecta");

  // onDelete: Cascade en el schema borra refresh tokens, favoritos,
  // watchlist e historial asociados.
  await prisma.user.delete({ where: { id: userId } });
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

export async function listSessions(userId: string, currentRawRefreshToken?: string): Promise<SessionSummary[]> {
  const currentHash = currentRawRefreshToken ? hashRefreshToken(currentRawRefreshToken) : null;

  const sessions = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  return sessions.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: currentHash !== null && s.tokenHash === currentHash,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.refreshToken.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) {
    throw ApiError.notFound("Sesión no encontrada");
  }

  await prisma.refreshToken.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function revokeOtherSessions(userId: string, currentRawRefreshToken?: string): Promise<void> {
  const currentHash = currentRawRefreshToken ? hashRefreshToken(currentRawRefreshToken) : null;

  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}
