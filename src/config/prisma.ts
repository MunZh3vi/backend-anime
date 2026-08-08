import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Prisma 7 requiere un driver adapter explícito en vez del motor embebido
// de versiones anteriores.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Singleton: evita abrir un pool de conexiones nuevo en cada hot-reload de tsx.
export const prisma = new PrismaClient({ adapter });
