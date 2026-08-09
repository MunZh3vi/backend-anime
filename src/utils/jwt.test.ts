import { describe, expect, it } from "vitest";
import {
  signAccessToken,
  signTwoFactorChallengeToken,
  verifyAccessToken,
  verifyTwoFactorChallengeToken,
} from "./jwt";
import { ApiError } from "./ApiError";

describe("access tokens", () => {
  it("firma y verifica un token, devolviendo el mismo userId", () => {
    const token = signAccessToken("user-123");
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("user-123");
  });

  it("rechaza un token con firma inválida", () => {
    const token = signAccessToken("user-123");
    const tampered = token.slice(0, -2) + (token.at(-2) === "a" ? "b" : "a") + token.at(-1);
    expect(() => verifyAccessToken(tampered)).toThrow(ApiError);
  });

  it("rechaza basura que no es un JWT", () => {
    expect(() => verifyAccessToken("no-soy-un-token")).toThrow(ApiError);
  });
});

describe("two-factor challenge tokens", () => {
  it("firma y verifica, y no lo confunde con un access token normal", () => {
    const challenge = signTwoFactorChallengeToken("user-456");
    expect(verifyTwoFactorChallengeToken(challenge).sub).toBe("user-456");

    // Un access token normal no tiene el claim "purpose" esperado.
    const normalAccessToken = signAccessToken("user-456");
    expect(() => verifyTwoFactorChallengeToken(normalAccessToken)).toThrow(ApiError);
  });
});
