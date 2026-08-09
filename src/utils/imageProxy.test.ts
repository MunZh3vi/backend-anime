import { describe, expect, it } from "vitest";
import { decryptImageUrl, encryptImageUrl, rewriteImageUrlsDeep, toProxiedImageUrl } from "./imageProxy";
import { ApiError } from "./ApiError";

describe("encryptImageUrl / decryptImageUrl", () => {
  it("hace un round-trip exacto", () => {
    const original = "https://cdn.animeav1.com/covers/12345.jpg";
    const token = encryptImageUrl(original);
    expect(decryptImageUrl(token)).toBe(original);
  });

  it("el token no contiene el dominio original en texto plano", () => {
    const token = encryptImageUrl("https://cdn.animeflv.net/portada.jpg");
    expect(token).not.toContain("animeflv");
    expect(token).not.toContain("http");
  });

  it("cifrar la misma URL dos veces da tokens distintos (IV aleatorio)", () => {
    const url = "https://cdn.animeav1.com/covers/1.jpg";
    expect(encryptImageUrl(url)).not.toBe(encryptImageUrl(url));
  });

  it("rechaza un token alterado", () => {
    const token = encryptImageUrl("https://cdn.animeav1.com/covers/1.jpg");
    const tampered = token.slice(0, -4) + (token.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(() => decryptImageUrl(tampered)).toThrow(ApiError);
  });

  it("rechaza basura que no es un token válido", () => {
    expect(() => decryptImageUrl("no-es-un-token-real")).toThrow(ApiError);
  });
});

describe("toProxiedImageUrl", () => {
  it("genera una ruta relativa con el token cifrado", () => {
    const result = toProxiedImageUrl("https://cdn.animeav1.com/covers/1.jpg");
    expect(result).toMatch(/^\/api\/v1\/anime\/image-proxy\?u=/);
  });

  it("devuelve null para valores no-string", () => {
    expect(toProxiedImageUrl(null)).toBeNull();
    expect(toProxiedImageUrl(undefined)).toBeNull();
    expect(toProxiedImageUrl(42)).toBeNull();
  });
});

describe("rewriteImageUrlsDeep", () => {
  it("reemplaza image/backdrop en un objeto anidado por rutas proxeadas", () => {
    const payload = {
      data: {
        image: "https://cdn.animeav1.com/covers/1.jpg",
        backdrop: "https://cdn.animeav1.com/banners/1.jpg",
        title: "One Piece",
      },
    };

    const rewritten = rewriteImageUrlsDeep(payload);
    expect(rewritten.data.image).toMatch(/^\/api\/v1\/anime\/image-proxy\?u=/);
    expect(rewritten.data.backdrop).toMatch(/^\/api\/v1\/anime\/image-proxy\?u=/);
    expect(rewritten.data.title).toBe("One Piece");
  });

  it("reescribe dentro de arrays y no toca campos que no son image/backdrop", () => {
    const payload = {
      results: [
        { image: "https://cdn.animeav1.com/1.jpg", slug: "one-piece" },
        { image: "https://cdn.animeav1.com/2.jpg", slug: "naruto" },
      ],
    };

    const rewritten = rewriteImageUrlsDeep(payload);
    expect(rewritten.results[0].image).toMatch(/^\/api\/v1\/anime\/image-proxy\?u=/);
    expect(rewritten.results[1].image).toMatch(/^\/api\/v1\/anime\/image-proxy\?u=/);
    expect(rewritten.results[0].slug).toBe("one-piece");
  });

  it("no explota con referencias circulares", () => {
    const circular: Record<string, unknown> = { image: "https://cdn.animeav1.com/1.jpg" };
    circular.self = circular;
    expect(() => rewriteImageUrlsDeep(circular)).not.toThrow();
  });
});
