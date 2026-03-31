import type { Request, Response, NextFunction } from "express";
import { z } from "zod/v4";
import { logger } from "../lib/logger";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
    return;
  }

  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: "Validation error",
      details: err.issues,
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
}
