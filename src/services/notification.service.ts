import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import type { NotificationType, Prisma } from "@prisma/client";

export interface PaginatedNotifications {
  items: Awaited<ReturnType<typeof prisma.notification.findMany>>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Prisma.InputJsonValue
) {
  return prisma.notification.create({ data: { userId, type, title, body, data } });
}

export async function listNotifications(
  userId: string,
  page: number,
  limit: number,
  unreadOnly: boolean
): Promise<PaginatedNotifications> {
  const where = { userId, ...(unreadOnly ? { read: false } : {}) };

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), unreadCount };
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
  if (result.count === 0) throw ApiError.notFound("Notificación no encontrada");
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}
