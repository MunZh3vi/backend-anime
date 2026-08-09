import { z } from "zod";

export const enableTwoFactorSchema = z.object({
  secret: z.string().min(1, "secret es requerido"),
  code: z.string().trim().length(6, "El código debe tener 6 dígitos"),
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, "La contraseña es requerida"),
  code: z.string().trim().length(6, "El código debe tener 6 dígitos"),
});

export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;
