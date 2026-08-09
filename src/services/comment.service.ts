import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { createNotification } from "./notification.service";
import { buildCommentTree } from "../utils/commentTree";
import type { CommentNode } from "../utils/commentTree";
import type { CreateCommentInput, UpdateCommentInput } from "../validators/comment.validators";

export type { CommentNode } from "../utils/commentTree";

export interface PaginatedComments {
  items: CommentNode[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listComments(
  animeId: string,
  episodeId: string | undefined,
  page: number,
  limit: number,
  viewerUserId?: string
): Promise<PaginatedComments> {
  const scope = { animeId, episodeId: episodeId ?? null };

  const [totalTopLevel, allRows] = await Promise.all([
    prisma.comment.count({ where: { ...scope, parentId: null } }),
    prisma.comment.findMany({
      where: scope,
      orderBy: { createdAt: "asc" },
      include: { user: { select: { username: true, avatarUrl: true } } },
    }),
  ]);

  const commentIds = allRows.map((r) => r.id);
  const [likeGroups, likedByMeRows] = await Promise.all([
    prisma.commentLike.groupBy({ by: ["commentId"], where: { commentId: { in: commentIds } }, _count: true }),
    viewerUserId
      ? prisma.commentLike.findMany({
          where: { commentId: { in: commentIds }, userId: viewerUserId },
          select: { commentId: true },
        })
      : Promise.resolve([]),
  ]);

  const likeCounts = new Map(likeGroups.map((g) => [g.commentId, g._count]));
  const likedByMeIds = new Set(likedByMeRows.map((r) => r.commentId));

  const byParent = buildCommentTree(allRows, likeCounts, likedByMeIds);
  const topLevel = (byParent.get(null) ?? []).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const start = (page - 1) * limit;
  const items = topLevel.slice(start, start + limit);

  return { items, page, limit, total: totalTopLevel, totalPages: Math.max(1, Math.ceil(totalTopLevel / limit)) };
}

export async function createComment(userId: string, input: CreateCommentInput) {
  let parent: Awaited<ReturnType<typeof prisma.comment.findUnique>> = null;
  if (input.parentId) {
    parent = await prisma.comment.findUnique({ where: { id: input.parentId } });
    if (!parent || parent.animeId !== input.animeId || parent.episodeId !== (input.episodeId ?? null)) {
      throw ApiError.badRequest("El comentario padre no existe en este mismo anime/episodio");
    }
  }

  const comment = await prisma.comment.create({
    data: {
      userId,
      animeId: input.animeId,
      episodeId: input.episodeId,
      parentId: input.parentId,
      content: input.content,
    },
    include: { user: { select: { username: true, avatarUrl: true } } },
  });

  if (parent && parent.userId !== userId) {
    await createNotification(
      parent.userId,
      "COMMENT_REPLY",
      `${comment.user.username} te respondió`,
      comment.content.slice(0, 140),
      { animeId: comment.animeId, episodeId: comment.episodeId, commentId: comment.id, parentId: parent.id }
    );
  }

  return {
    id: comment.id,
    userId: comment.userId,
    username: comment.user.username,
    avatarUrl: comment.user.avatarUrl,
    animeId: comment.animeId,
    episodeId: comment.episodeId,
    parentId: comment.parentId,
    content: comment.content,
    deleted: false,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    likeCount: 0,
    likedByMe: false,
    replies: [] as CommentNode[],
  };
}

export async function updateComment(userId: string, commentId: string, input: UpdateCommentInput) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw ApiError.notFound("Comentario no encontrado");
  if (comment.userId !== userId) throw ApiError.forbidden("No podés editar el comentario de otra persona");

  await prisma.comment.update({ where: { id: commentId }, data: { content: input.content } });
}

export async function deleteComment(userId: string, commentId: string, isModerator = false): Promise<void> {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw ApiError.notFound("Comentario no encontrado");
  if (comment.userId !== userId && !isModerator) {
    throw ApiError.forbidden("No podés borrar el comentario de otra persona");
  }

  // Borrado lógico: conserva el nodo para no huerfanar las respuestas del hilo.
  await prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
}

export async function reportComment(reporterId: string, commentId: string, reason: string): Promise<void> {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw ApiError.notFound("Comentario no encontrado");

  await prisma.commentReport.upsert({
    where: { commentId_reporterId: { commentId, reporterId } },
    create: { commentId, reporterId, reason },
    update: { reason, status: "PENDING", resolvedAt: null },
  });
}

export async function likeComment(userId: string, commentId: string): Promise<void> {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw ApiError.notFound("Comentario no encontrado");

  await prisma.commentLike.upsert({
    where: { userId_commentId: { userId, commentId } },
    create: { userId, commentId },
    update: {},
  });
}

export async function unlikeComment(userId: string, commentId: string): Promise<void> {
  await prisma.commentLike.deleteMany({ where: { userId, commentId } });
}
