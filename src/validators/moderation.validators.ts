import { z } from "zod";

export const banUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const setRoleSchema = z.object({
  role: z.enum(["USER", "MODERATOR", "ADMIN"]),
});

export const resolveReportSchema = z.object({
  action: z.enum(["dismiss", "delete_comment"]),
});

export const listReportsQuerySchema = z.object({
  status: z.enum(["PENDING", "RESOLVED", "DISMISSED"]).default("PENDING"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type BanUserInput = z.infer<typeof banUserSchema>;
export type SetRoleInput = z.infer<typeof setRoleSchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;
