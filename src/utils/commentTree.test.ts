import { describe, expect, it } from "vitest";
import { buildCommentTree, CommentRow } from "./commentTree";

function row(overrides: Partial<CommentRow> & Pick<CommentRow, "id">): CommentRow {
  return {
    userId: "user-1",
    animeId: "anime-1",
    episodeId: null,
    parentId: null,
    content: `contenido de ${overrides.id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    user: { username: "juan", avatarUrl: null },
    ...overrides,
  };
}

describe("buildCommentTree", () => {
  it("cuelga las respuestas de su comentario padre", () => {
    const rows = [row({ id: "root" }), row({ id: "reply-1", parentId: "root" }), row({ id: "reply-2", parentId: "root" })];

    const byParent = buildCommentTree(rows, new Map(), new Set());
    const topLevel = byParent.get(null) ?? [];

    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].id).toBe("root");
    expect(topLevel[0].replies.map((r) => r.id).sort()).toEqual(["reply-1", "reply-2"]);
  });

  it("soporta hilos de más de un nivel", () => {
    const rows = [
      row({ id: "root" }),
      row({ id: "child", parentId: "root" }),
      row({ id: "grandchild", parentId: "child" }),
    ];

    const byParent = buildCommentTree(rows, new Map(), new Set());
    const root = (byParent.get(null) ?? [])[0];

    expect(root.replies[0].id).toBe("child");
    expect(root.replies[0].replies[0].id).toBe("grandchild");
  });

  it("enmascara el contenido de comentarios borrados pero conserva la fila para no huerfanar respuestas", () => {
    const rows = [
      row({ id: "root", deletedAt: new Date("2026-01-02T00:00:00Z"), content: "texto original" }),
      row({ id: "reply", parentId: "root" }),
    ];

    const byParent = buildCommentTree(rows, new Map(), new Set());
    const root = (byParent.get(null) ?? [])[0];

    expect(root.deleted).toBe(true);
    expect(root.content).toBe("[comentario eliminado]");
    expect(root.replies).toHaveLength(1);
  });

  it("aplica likeCount y likedByMe desde los mapas dados", () => {
    const rows = [row({ id: "root" })];
    const likeCounts = new Map([["root", 5]]);
    const likedByMeIds = new Set(["root"]);

    const byParent = buildCommentTree(rows, likeCounts, likedByMeIds);
    const root = (byParent.get(null) ?? [])[0];

    expect(root.likeCount).toBe(5);
    expect(root.likedByMe).toBe(true);
  });

  it("un comentario sin likes registrados tiene likeCount 0 y likedByMe false", () => {
    const rows = [row({ id: "root" })];
    const byParent = buildCommentTree(rows, new Map(), new Set());
    const root = (byParent.get(null) ?? [])[0];

    expect(root.likeCount).toBe(0);
    expect(root.likedByMe).toBe(false);
  });
});
