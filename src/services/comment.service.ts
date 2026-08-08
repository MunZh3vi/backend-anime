import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import type { CreateCommentInput, UpdateCommentInput } from "../validators/comment.validators";

const DELETED_PLACEHOLDER = "[comentario eliminado]";

interface CommentRow {
  id: string;
  userId: string;
  animeId: string;
  episodeId: string | null;
  parentId: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user: { username: string; avatarUrl: string | null };
}

export interface CommentNode {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  animeId: string;
  episodeId: string | null;
  parentId: string | null;
  content: string;
  deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  likeCount: number;
  likedByMe: boolean;
  replies: CommentNode[];
}

export interface PaginatedComments {
  items: CommentNode[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function buildTree(
  rows: CommentRow[],
  likeCounts: Map<string, number>,
  likedByMeIds: Set<string>
): Map<string | null, CommentNode[]> {
  const nodesById = new Map<string, CommentNode>();
  for (const row of rows) {
    nodesById.set(row.id, {
      id: row.id,
      userId: row.userId,
      username: row.user.username,
      avatarUrl: row.user.avatarUrl,
      animeId: row.animeId,
      episodeId: row.episodeId,
      parentId: row.parentId,
      content: row.deletedAt ? DELETED_PLACEHOLDER : row.content,
      deleted: Boolean(row.deletedAt),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      likeCount: likeCounts.get(row.id) ?? 0,
      likedByMe: likedByMeIds.has(row.id),
      replies: [],
    });
  }

  const byParent = new Map<string | null, CommentNode[]>();
  for (const row of rows) {
    const node = nodesById.get(row.id)!;
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(node);
    byParent.set(row.parentId, siblings);
  }

  // Cuelga cada respuesta de su nodo padre (los hijos de un nodo son las
  // filas cuyo parentId es su propio id).
  for (const node of nodesById.values()) {
    node.replies = byParent.get(node.id) ?? [];
  }

  return byParent;
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

  const byParent = buildTree(allRows, likeCounts, likedByMeIds);
  const topLevel = (byParent.get(null) ?? []).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const start = (page - 1) * limit;
  const items = topLevel.slice(start, start + limit);

  return { items, page, limit, total: totalTopLevel, totalPages: Math.max(1, Math.ceil(totalTopLevel / limit)) };
}

export async function createComment(userId: string, input: CreateCommentInput) {
  if (input.parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: input.parentId } });
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

export async function deleteComment(userId: string, commentId: string): Promise<void> {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw ApiError.notFound("Comentario no encontrado");
  if (comment.userId !== userId) throw ApiError.forbidden("No podés borrar el comentario de otra persona");

  // Borrado lógico: conserva el nodo para no huerfanar las respuestas del hilo.
  await prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
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
