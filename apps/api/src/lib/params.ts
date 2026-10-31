import type { Request } from "express";
import { AppError } from "./errors";

/** A route parameter as a string (Express widens params when middleware precedes the handler). */
export function pathParam(req: Request, name: string): string {
  const value: unknown = req.params[name];
  if (typeof value !== "string" || value.length === 0)
    throw new AppError("NOT_FOUND", "Not found.");
  return value;
}
