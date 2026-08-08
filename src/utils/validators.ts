import { ApiError } from "./ApiError";

export function requireQueryString(value: unknown, paramName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw ApiError.badRequest(`El parámetro '${paramName}' es requerido`);
  }
  return value.trim();
}
