import { z } from "zod";

export const updateProfileSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "El nombre de usuario solo puede tener letras, números y guion bajo")
    .optional(),
  avatarUrl: z.string().trim().url("La URL del avatar no es válida").optional(),
  bio: z.string().trim().max(500, "La bio no puede superar 500 caracteres").optional(),
  // FRIENDS se acepta y se guarda, pero hoy se trata igual que PRIVATE al
  // resolver qué puede ver un visitante (no existe un sistema de amistades).
  profileVisibility: z.enum(["PUBLIC", "FRIENDS", "PRIVATE"]).optional(),
  matureContentEnabled: z.boolean().optional(),
});

export const changeEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Email inválido"),
  password: z.string().min(1, "La contraseña es requerida para cambiar el email"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "La contraseña actual es requerida"),
    newPassword: z.string().min(8, "La nueva contraseña debe tener al menos 8 caracteres").max(72),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "La nueva contraseña debe ser distinta de la actual",
    path: ["newPassword"],
  });

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "La contraseña es requerida para eliminar la cuenta"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
