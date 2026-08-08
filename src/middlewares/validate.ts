import { NextFunction, Request, Response } from "express";
import { ZodType } from "zod";
import { ApiError } from "../utils/ApiError";

type Source = "body" | "query" | "params";

export function validate(schema: ZodType, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.issues.map((issue) => `${issue.path.join(".") || source}: ${issue.message}`).join("; ");
      return next(ApiError.badRequest(message));
    }

    req[source] = result.data;
    next();
  };
}
