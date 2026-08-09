import { describe, expect, it } from "vitest";
import { ApiError } from "./ApiError";

describe("ApiError", () => {
  it("expone statusCode y message en los factory estáticos", () => {
    expect(ApiError.badRequest("mal").statusCode).toBe(400);
    expect(ApiError.unauthorized("no auth").statusCode).toBe(401);
    expect(ApiError.forbidden("prohibido").statusCode).toBe(403);
    expect(ApiError.notFound("no existe").statusCode).toBe(404);
    expect(ApiError.conflict("duplicado").statusCode).toBe(409);
    expect(ApiError.tooManyRequests("rate limit").statusCode).toBe(429);
    expect(ApiError.upstream("proveedor caído").statusCode).toBe(502);
    expect(ApiError.internal("boom").statusCode).toBe(500);
  });

  it("es instancia de Error con el mensaje correcto", () => {
    const err = ApiError.notFound("Comentario no encontrado");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Comentario no encontrado");
    expect(err.name).toBe("ApiError");
  });

  it("guarda details opcional", () => {
    const err = new ApiError(500, "algo falló", "stacktrace o detalle interno");
    expect(err.details).toBe("stacktrace o detalle interno");
  });
});
