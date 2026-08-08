import { Response } from "express";

export function sendSuccess<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({
    success: true,
    data,
  });
}

export function sendError(res: Response, status: number, message: string, details?: string) {
  return res.status(status).json({
    success: false,
    error: message,
    status,
    ...(details ? { details } : {}),
  });
}
