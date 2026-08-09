import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(72, "La contraseña no puede superar 72 caracteres"); // límite real de bcrypt

const usernameSchema = z
  .string()
  .trim()
  .min(3, "El nombre de usuario debe tener al menos 3 caracteres")
  .max(32, "El nombre de usuario no puede superar 32 caracteres")
  .regex(/^[a-zA-Z0-9_]+$/, "El nombre de usuario solo puede tener letras, números y guion bajo");

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Email inválido"),
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export const refreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const verifyEmailQuerySchema = z.object({
  token: z.string().min(1, "El parámetro 'token' es requerido"),
});

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1, "challengeToken es requerido"),
  code: z.string().trim().min(6, "El código debe tener 6 dígitos").max(6),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type TwoFactorLoginInput = z.infer<typeof twoFactorLoginSchema>;
