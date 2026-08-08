export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: string;

  constructor(statusCode: number, message: string, details?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message: string) {
    return new ApiError(400, message);
  }

  static notFound(message: string) {
    return new ApiError(404, message);
  }

  static unauthorized(message: string) {
    return new ApiError(401, message);
  }

  static forbidden(message: string) {
    return new ApiError(403, message);
  }

  static conflict(message: string) {
    return new ApiError(409, message);
  }

  static tooManyRequests(message: string) {
    return new ApiError(429, message);
  }

  static upstream(message: string) {
    // La fuente de scraping (AnimeFLV/AnimeAV1) no respondió como se esperaba.
    return new ApiError(502, message);
  }

  static internal(message: string) {
    return new ApiError(500, message);
  }
}
