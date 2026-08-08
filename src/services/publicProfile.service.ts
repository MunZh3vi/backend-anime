import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import type { ProfileVisibility, User } from "@prisma/client";

export interface PublicProfileStats {
  series: number;
  episodes: number;
  hours: number;
}

export interface PublicProfile {
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: Date;
  profileVisibility: ProfileVisibility;
  // null cuando el perfil no es visible para quien pregunta.
  stats: PublicProfileStats | null;
}

// FRIENDS se trata igual que PRIVATE: no existe un grafo de amistades
// todavía, así que solo el propio dueño o un perfil PUBLIC son visibles.
function isViewableBy(user: Pick<User, "id" | "profileVisibility">, viewerUserId?: string): boolean {
  if (viewerUserId && viewerUserId === user.id) return true;
  return user.profileVisibility === "PUBLIC";
}

async function findUserByUsername(username: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw ApiError.notFound("Usuario no encontrado");
  return user;
}

async function computeStats(userId: string): Promise<PublicProfileStats> {
  const [seriesGroups, episodeCount, durationAgg] = await Promise.all([
    prisma.watchHistoryEntry.groupBy({ by: ["animeId"], where: { userId } }),
    prisma.watchHistoryEntry.count({ where: { userId } }),
    prisma.watchHistoryEntry.aggregate({ where: { userId }, _sum: { progressSeconds: true } }),
  ]);

  const totalSeconds = durationAgg._sum.progressSeconds ?? 0;
  return {
    series: seriesGroups.length,
    episodes: episodeCount,
    hours: Math.round((totalSeconds / 3600) * 10) / 10,
  };
}

export async function getPublicProfile(username: string, viewerUserId?: string): Promise<PublicProfile> {
  const user = await findUserByUsername(username);
  const viewable = isViewableBy(user, viewerUserId);

  return {
    username: user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    createdAt: user.createdAt,
    profileVisibility: user.profileVisibility,
    stats: viewable ? await computeStats(user.id) : null,
  };
}

export function listFavoritesByUsername(username: string, viewerUserId?: string) {
  return findUserByUsername(username).then((user) => {
    if (!isViewableBy(user, viewerUserId)) {
      throw ApiError.forbidden("Este perfil es privado");
    }
    return prisma.favorite.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  });
}
