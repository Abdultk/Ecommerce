import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { fail } from "@hp/contracts";
import { AppError } from "../lib/errors";
import { safeErrorFields } from "../lib/safe-error";

type ErrorLog = { error: (obj: object, msg: string) => void };

type BodyParserError = Error & { type?: string; status?: number };
const isBodyParserError = (err: unknown): err is BodyParserError =>
  err instanceof Error && typeof (err as BodyParserError).type === "string";

/** Turns every thrown error into the contract's failure envelope. Never leaks internals. */
export function createErrorHandler(log: ErrorLog): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json(fail(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      return res
        .status(400)
        .json(fail("VALIDATION_ERROR", "Some fields are invalid.", err.flatten().fieldErrors));
    }
    if (isBodyParserError(err) && err.type === "entity.parse.failed") {
      return res.status(400).json(fail("VALIDATION_ERROR", "The request body isn't valid JSON."));
    }
    if (isBodyParserError(err) && err.type === "entity.too.large") {
      return res.status(413).json(fail("VALIDATION_ERROR", "The request body is too large."));
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json(fail("CONFLICT", "That already exists."));
    }

    // Type, code and stack frames only: messages can echo user data (emails, SQL values).
    log.error(
      { code: "INTERNAL", err: safeErrorFields(err), method: req.method, path: req.path },
      "unhandled error",
    );
    return res.status(500).json(fail("INTERNAL", "Something went wrong. Please try again."));
  };
}
