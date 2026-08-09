const DELETED_PLACEHOLDER = "[comentario eliminado]";

export interface CommentRow {
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

/**
 * Arma el árbol de hilos a partir de una consulta plana (una sola query, sin
 * recursión en la DB): cuelga cada fila de su parentId. Extraído a un módulo
 * sin dependencias de Prisma para poder testearlo sin una base de datos real.
 */
export function buildCommentTree(
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
