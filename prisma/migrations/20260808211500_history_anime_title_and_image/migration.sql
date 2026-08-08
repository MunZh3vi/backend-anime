-- AlterTable
-- anime_title se agrega con un default temporal para no romper filas ya
-- existentes (ej. datos de prueba); se saca el default después para que
-- Prisma lo exija en todos los inserts nuevos, tal como pide el schema.
ALTER TABLE "watch_history" ADD COLUMN "anime_title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "watch_history" ADD COLUMN "image" TEXT;
ALTER TABLE "watch_history" ALTER COLUMN "anime_title" DROP DEFAULT;
