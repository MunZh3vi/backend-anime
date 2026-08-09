import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, twoFactorLoginSchema } from "./auth.validators";

describe("registerSchema", () => {
  const base = {
    email: "Test@Example.com",
    username: "juan_perez1",
    password: "claveSegura123",
    confirmPassword: "claveSegura123",
  };

  it("acepta datos válidos y normaliza el email a minúsculas", () => {
    const result = registerSchema.parse(base);
    expect(result.email).toBe("test@example.com");
  });

  it("rechaza si las contraseñas no coinciden", () => {
    const result = registerSchema.safeParse({ ...base, confirmPassword: "otraClave" });
    expect(result.success).toBe(false);
  });

  it("rechaza username con caracteres inválidos", () => {
    const result = registerSchema.safeParse({ ...base, username: "juan perez!" });
    expect(result.success).toBe(false);
  });

  it("rechaza contraseñas menores a 8 caracteres", () => {
    const result = registerSchema.safeParse({ ...base, password: "1234567", confirmPassword: "1234567" });
    expect(result.success).toBe(false);
  });

  it("rechaza email inválido", () => {
    const result = registerSchema.safeParse({ ...base, email: "no-es-un-email" });
    expect(result.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("acepta email+password válidos", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });

  it("rechaza password vacío", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("twoFactorLoginSchema", () => {
  it("exige código de 6 dígitos", () => {
    expect(twoFactorLoginSchema.safeParse({ challengeToken: "t", code: "123456" }).success).toBe(true);
    expect(twoFactorLoginSchema.safeParse({ challengeToken: "t", code: "123" }).success).toBe(false);
  });
});
