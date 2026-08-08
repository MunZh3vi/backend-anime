import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { hashPassword, verifyPassword } from "../utils/password";
import { PublicUser, toPublicUser } from "./auth.service";
import type { ChangePasswordInput, UpdateProfileInput } from "../validators/user.validators";

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
    },
  });

  return toPublicUser(user);
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
