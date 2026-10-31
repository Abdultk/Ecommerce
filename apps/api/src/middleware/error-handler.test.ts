import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createErrorHandler } from "./error-handler";
import { AppError } from "../lib/errors";

function appThatThrows(err: unknown) {
  const log = { error: vi.fn(), warn: vi.fn() };
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.post("/boom", () => {
    throw err;
  });
  app.use(createErrorHandler(log));
  return { app, log };
}

describe("error handler", () => {
  it("maps AppError to its status and envelope", async () => {
    const { app } = appThatThrows(new AppError("OUT_OF_STOCK", "Only 2 left.", { available: 2 }));
    const res = await request(app).post("/boom");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: "OUT_OF_STOCK", message: "Only 2 left.", details: { available: 2 } },
    });
  });

  it("maps ZodError to VALIDATION_ERROR with field errors", async () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: "nope" });
    const { app } = appThatThrows(parsed.error);
    const res = await request(app).post("/boom");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.email).toBeDefined();
  });

  it("maps malformed JSON to VALIDATION_ERROR", async () => {
    const { app } = appThatThrows(new Error("unreachable"));
    const res = await request(app)
      .post("/boom")
      .set("Content-Type", "application/json")
      .send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "The request body isn't valid JSON.",
    });
  });

  it("maps an oversized body to VALIDATION_ERROR", async () => {
    const { app } = appThatThrows(new Error("unreachable"));
    const res = await request(app)
      .post("/boom")
      .send({ text: "x".repeat(5_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps a unique-constraint violation to CONFLICT", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6",
    });
    const { app } = appThatThrows(err);
    const res = await request(app).post("/boom");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("hides unexpected errors behind a generic 500 and logs them", async () => {
    const { app, log } = appThatThrows(new Error("db password is hunter2"));
    const res = await request(app).post("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({
      code: "INTERNAL",
      message: "Something went wrong. Please try again.",
    });
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(log.error).toHaveBeenCalledOnce();
    // The log keeps the error type, a stable code and stack frames, never the message.
    const logged = log.error.mock.calls[0]![0] as Record<string, unknown>;
    expect(JSON.stringify(logged)).not.toContain("hunter2");
    expect(logged).toMatchObject({ code: "INTERNAL", method: "POST", path: "/boom" });
    expect(logged.err).toMatchObject({ type: "Error" });
  });
});
