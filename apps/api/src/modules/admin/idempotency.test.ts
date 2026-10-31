import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const env: Record<string, string> = {
    DATABASE_URL: "postgresql://x:y@localhost:5432/unit_test",
    RATE_LIMIT_STORE: "memory",
    JWT_ACCESS_SECRET: "unit-access-secret-0123456789abcdef0123456789",
    REFRESH_TOKEN_PEPPER: "unit-refresh-pepper-0123456789abcdef01234567",
    COOKIE_SECRET: "unit-cookie-secret-0123456789abcdef0123456789",
    ORDER_LOOKUP_SECRET: "unit-order-lookup-secret-0123456789abcdef012",
    TOTP_ENCRYPTION_KEY: `${"0".repeat(63)}1`,
    WEB_ORIGIN: "http://localhost:3000",
    ADMIN_ORIGIN: "http://localhost:3001",
    LOG_LEVEL: "silent",
  };
  for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
});

import express from "express";
import request from "supertest";
import type { Db } from "../../lib/prisma";
import { idempotent, type Outcome, type RunContext } from "./idempotency";

type Run = (ctx: RunContext) => Promise<Outcome>;

function appWith(records: Record<string, unknown>, run: Run) {
  const app = express();
  app.use(express.json());
  app.post("/x", (req, res, next) => {
    req.user = { sub: "admin-1", role: "ADMIN", tfa: true } as never;
    idempotent(req, res, run, { idempotencyRecord: records } as unknown as Db).catch(next);
  });
  return app;
}

describe("idempotent()", () => {
  it("still returns the success when storing the response fails (review #2)", async () => {
    const records = {
      create: vi.fn(async () => ({ id: "rec-1" })),
      update: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    };
    const run = vi.fn<Run>(async () => ({ status: 200, body: { ok: 1 } }));
    const res = await request(appWith(records, run))
      .post("/x")
      .set("Idempotency-Key", "k1")
      .send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: 1 });
    expect(run).toHaveBeenCalledOnce();
  });

  it("gives the work a stable provider key derived from the admin's key (M5)", async () => {
    const seen: (string | null)[] = [];
    const records = { create: vi.fn(async () => ({ id: "r" })), update: vi.fn(async () => ({})) };
    const run: Run = async (ctx) => {
      seen.push(ctx.providerKey);
      return { status: 200, body: {} };
    };
    const app = appWith(records, run);
    await request(app).post("/x").set("Idempotency-Key", "k1").send({});
    await request(app).post("/x").set("Idempotency-Key", "k1").send({});
    await request(app).post("/x").send({});
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBeNull();
  });
});
