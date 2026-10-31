import { Router } from "express";
import type { Redis } from "ioredis";
import { fail, ok } from "@hp/contracts";
import { prisma } from "../../lib/prisma";

type Check = "ok" | "error" | "skipped";

async function check(fn: () => Promise<unknown>): Promise<Check> {
  try {
    await fn();
    return "ok";
  } catch {
    return "error";
  }
}

/** Liveness + readiness. Used by Render's health check and the post-deploy smoke test. */
export function healthRouter(redis: Redis | null): Router {
  const router = Router();
  // Liveness only: no database or Redis call, so a dependency outage never gets the
  // process restarted. Readiness (dependencies included) stays at GET /health.
  router.get("/live", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(ok({ status: "ok" }));
  });
  router.get("/", async (_req, res) => {
    const db = await check(() => prisma.$queryRaw`SELECT 1`);
    const cache: Check = redis ? await check(() => redis.ping()) : "skipped";
    const status = { db, redis: cache };
    res.setHeader("Cache-Control", "no-store");
    if (db === "error" || cache === "error") {
      return res.status(503).json(fail("INTERNAL", "Service unavailable.", status));
    }
    res.json(ok(status));
  });
  return router;
}
