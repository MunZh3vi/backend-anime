import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("genera un hash distinto del texto plano y lo verifica correctamente", async () => {
    const hash = await hashPassword("miClaveSegura123");
    expect(hash).not.toBe("miClaveSegura123");
    expect(await verifyPassword("miClaveSegura123", hash)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("miClaveSegura123");
    expect(await verifyPassword("otraClave", hash)).toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos (salt aleatorio)", async () => {
    const [a, b] = await Promise.all([hashPassword("repetida"), hashPassword("repetida")]);
    expect(a).not.toBe(b);
  });
});
