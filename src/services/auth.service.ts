import { randomBytes } from "node:crypto";
import { verify as verifyTotp } from "otplib";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";
import { hashPassword, verifyPassword } from "../utils/password";
import { signAccessToken, signTwoFactorChallengeToken, verifyTwoFactorChallengeToken } from "../utils/jwt";
import { generateRefreshToken, hashRefreshToken } from "../utils/refreshToken";
import type { Role, User } from "@prisma/client";
import type { LoginInput, RegisterInput } from "../validators/auth.validators";

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  subscriptionStatus: string;
  role: Role;
  isEmailVerified: boolean;
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
  matureContentEnabled: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

export interface DeviceMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export type LoginResult = AuthResult | { twoFactorRequired: true; challengeToken: string };

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    subscriptionStatus: user.subscriptionStatus,
    role: user.role,
    isEmailVerified: user.isEmailVerified,
    profileVisibility: user.profileVisibility,
    matureContentEnabled: user.matureContentEnabled,
    twoFactorEnabled: user.twoFactorEnabled,
    createdAt: user.createdAt,
  };
}

function assertNotBanned(user: User): void {
  if (user.bannedAt) {
    throw ApiError.forbidden(`Tu cuenta fue suspendida${user.banReason ? `: ${user.banReason}` : ""}`);
  }
}

async function issueTokenPair(
  userId: string,
  device: DeviceMeta = {}
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken(userId);
  const refreshToken = generateRefreshToken();

  const expiresAt = new Date(Date.now() + env.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: device.userAgent ?? null,
      ipAddress: device.ipAddress ?? null,
    },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput, device: DeviceMeta = {}): Promise<AuthResult> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { username: input.username }] },
  });

  if (existing) {
    throw ApiError.conflict(
      existing.email === input.email ? "Ya existe una cuenta con ese email" : "Ese nombre de usuario ya está en uso"
    );
  }

  const passwordHash = await hashPassword(input.password);
  const emailVerificationToken = randomBytes(32).toString("hex");

  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      passwordHash,
      emailVerificationToken,
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Sin proveedor de email configurado todavía: se deja constancia en el log
  // para poder verificar manualmente en desarrollo. Ver GET /api/auth/verify-email.
  logger.info(`Verificación de email para ${user.email}: token=${emailVerificationToken}`);

  const tokens = await issueTokenPair(user.id, device);
  return { user: toPublicUser(user), ...tokens };
}

export async function login(input: LoginInput, device: DeviceMeta = {}): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw ApiError.unauthorized("Email o contraseña incorrectos");
  }

  const validPassword = await verifyPassword(input.password, user.passwordHash);
  if (!validPassword) {
    throw ApiError.unauthorized("Email o contraseña incorrectos");
  }

  assertNotBanned(user);

  if (user.twoFactorEnabled) {
    return { twoFactorRequired: true, challengeToken: signTwoFactorChallengeToken(user.id) };
  }

  const tokens = await issueTokenPair(user.id, device);
  return { user: toPublicUser(user), ...tokens };
}

export async function completeTwoFactorLogin(
  challengeToken: string,
  code: string,
  device: DeviceMeta = {}
): Promise<AuthResult> {
  const { sub: userId } = verifyTwoFactorChallengeToken(challengeToken);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    throw ApiError.unauthorized("No se pudo completar el inicio de sesión");
  }

  assertNotBanned(user);

  const { valid } = await verifyTotp({ secret: user.twoFactorSecret, token: code });
  if (!valid) throw ApiError.unauthorized("Código de verificación incorrecto");

  const tokens = await issueTokenPair(user.id, device);
  return { user: toPublicUser(user), ...tokens };
}

export async function refresh(
  rawRefreshToken: string,
  device: DeviceMeta = {}
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized("Refresh token inválido o expirado");
  }

  // Rotación: se revoca el token usado y se emite uno nuevo, para que un
  // refresh token robado y reutilizado quede invalidado en el primer uso legítimo.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueTokenPair(stored.userId, device);
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;

  const tokenHash = hashRefreshToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });

  if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
    throw ApiError.badRequest("Token de verificación inválido o expirado");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isEmailVerified: true, emailVerificationToken: null, emailVerificationExpires: null },
  });
}

export { toPublicUser };
