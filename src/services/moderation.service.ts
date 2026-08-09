import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { toPublicUser, type PublicUser } from "./auth.service";
import type { Role } from "@prisma/client";

export async function banUser(targetUserId: string, reason: string | undefined): Promise<PublicUser> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw ApiError.notFound("Usuario no encontrado");
  if (target.role === "ADMIN") throw ApiError.forbidden("No se puede banear a un admin");

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { bannedAt: new Date(), banReason: reason ?? null },
  });

  // Cortar sus sesiones activas: un baneo debe surtir efecto de inmediato,
  // no recién cuando expire el access token que ya tenga.
  await prisma.refreshToken.updateMany({
    where: { userId: targetUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return toPublicUser(updated);
}

export async function unbanUser(targetUserId: string): Promise<PublicUser> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw ApiError.notFound("Usuario no encontrado");

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { bannedAt: null, banReason: null },
  });

  return toPublicUser(updated);
}

export async function setUserRole(targetUserId: string, role: Role): Promise<PublicUser> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw ApiError.notFound("Usuario no encontrado");

  const updated = await prisma.user.update({ where: { id: targetUserId }, data: { role } });
  return toPublicUser(updated);
}

export interface ReportSummary {
  id: string;
  reason: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  reporter: { id: string; username: string };
  comment: {
    id: string;
    content: string;
    deleted: boolean;
    animeId: string;
    episodeId: string | null;
    author: { id: string; username: string };
  } | null;
}

export async function listReports(status: "PENDING" | "RESOLVED" | "DISMISSED", page: number, limit: number) {
  const [total, reports] = await Promise.all([
    prisma.commentReport.count({ where: { status } }),
    prisma.commentReport.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { reporter: { select: { id: true, username: true } } },
    }),
  ]);

  const commentIds = reports.map((r) => r.commentId);
  const comments = await prisma.comment.findMany({
    where: { id: { in: commentIds } },
    include: { user: { select: { id: true, username: true } } },
  });
  const commentsById = new Map(comments.map((c) => [c.id, c]));

  const items: ReportSummary[] = reports.map((r) => {
    const comment = commentsById.get(r.commentId);
    return {
      id: r.id,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      reporter: r.reporter,
      comment: comment
        ? {
            id: comment.id,
            content: comment.deletedAt ? "[comentario eliminado]" : comment.content,
            deleted: Boolean(comment.deletedAt),
            animeId: comment.animeId,
            episodeId: comment.episodeId,
            author: comment.user,
          }
        : null,
    };
  });

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function resolveReport(reportId: string, action: "dismiss" | "delete_comment"): Promise<void> {
  const report = await prisma.commentReport.findUnique({ where: { id: reportId } });
  if (!report || report.status !== "PENDING") throw ApiError.notFound("Reporte no encontrado o ya resuelto");

  if (action === "delete_comment") {
    await prisma.comment.update({ where: { id: report.commentId }, data: { deletedAt: new Date() } }).catch(() => {
      // El comentario puede ya no existir; no es motivo para fallar el resolve.
    });
  }

  await prisma.commentReport.update({
    where: { id: reportId },
    data: { status: action === "delete_comment" ? "RESOLVED" : "DISMISSED", resolvedAt: new Date() },
  });
}
