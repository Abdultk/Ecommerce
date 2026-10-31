import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { Prisma, type IdempotencyRecord } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { fingerprint } from "../../lib/fingerprint";
import { logger } from "../../lib/logger";
import { prisma, type Db } from "../../lib/prisma";
import { safeErrorFields } from "../../lib/safe-error";

/** Same format the checkout endpoint accepts. */
export const IdempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/, "Invalid Idempotency-Key.");

/** Replays are honoured for a day; the worker purges older records. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 3_600_000;
/**
 * An in-flight record older than this belongs to a crashed request and may be taken over.
 * It must exceed the longest possible run: the Stripe SDK allows 20 s per attempt with 2
 * retries (60 s), plus database work. Ten minutes leaves a wide margin, and even a takeover
 * reuses the same provider idempotency key (below), so money can't move twice.
 */
export const IN_FLIGHT_TAKEOVER_MS = 10 * 60_000;

export type Outcome = { status: number; body: unknown };

/**
 * providerKey: stable for one admin + Idempotency-Key, for the payment provider's own
 * idempotency key. Null when the request carried no key.
 */
export type RunContext = { providerKey: string | null };

type Claim = { kind: "new"; id: string } | { kind: "replay"; record: IdempotencyRecord };

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

async function claim(db: Db, scope: string, key: string, requestHash: string): Promise<Claim> {
  try {
    const created = await db.idempotencyRecord.create({ data: { scope, key, requestHash } });
    return { kind: "new", id: created.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  const existing = await db.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
  if (!existing) return claim(db, scope, key, requestHash); // purged in between
  if (existing.requestHash !== requestHash) {
    throw new AppError(
      "CONFLICT",
      "This Idempotency-Key was already used for a different request. Use a new key.",
    );
  }
  if (existing.responseStatus !== null) return { kind: "replay", record: existing };
  const stale = Date.now() - existing.createdAt.getTime() > IN_FLIGHT_TAKEOVER_MS;
  if (!stale) {
    throw new AppError("CONFLICT", "That request is still being processed. Try again shortly.");
  }
  await db.idempotencyRecord.deleteMany({ where: { id: existing.id, responseStatus: null } });
  return claim(db, scope, key, requestHash);
}

const send = (res: Response, outcome: Outcome) => res.status(outcome.status).json(outcome.body);

/**
 * Runs an admin mutation at most once per Idempotency-Key. The header is optional; when
 * sent, keys are scoped to the signed-in admin, the request (method, path, canonical body)
 * is fingerprinted, a repeat with the same fingerprint replays the stored response with
 * `Idempotent-Replayed: true`, and a repeat with a different one gets 409. A failed attempt
 * stores nothing, so it can be retried with the same key.
 */
export async function idempotent(
  req: Request,
  res: Response,
  run: (ctx: RunContext) => Promise<Outcome>,
  db: Db = prisma,
): Promise<void> {
  const header = req.header("Idempotency-Key");
  if (header === undefined) {
    send(res, await run({ providerKey: null }));
    return;
  }
  const key = IdempotencyKey.parse(header);
  const scope = `admin:${req.user!.sub}`;
  const requestHash = fingerprint({
    method: req.method,
    path: `${req.baseUrl}${req.path}`,
    body: req.body ?? null,
  });
  const claimed = await claim(db, scope, key, requestHash);
  if (claimed.kind === "replay") {
    res.setHeader("Idempotent-Replayed", "true");
    send(res, { status: claimed.record.responseStatus!, body: claimed.record.responseBody });
    return;
  }

  let outcome: Outcome;
  try {
    outcome = await run({
      providerKey: createHash("sha256").update(`${scope}:${key}`).digest("hex"),
    });
  } catch (err) {
    await db.idempotencyRecord.deleteMany({ where: { id: claimed.id } }).catch((cleanup) => {
      logger.error({ err: safeErrorFields(cleanup) }, "could not release idempotency key");
    });
    throw err;
  }
  try {
    await db.idempotencyRecord.update({
      where: { id: claimed.id },
      data: {
        responseStatus: outcome.status,
        responseBody: JSON.parse(JSON.stringify(outcome.body)) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // The work succeeded; say so. A retry sees the record in flight (409) until the takeover
    // window passes, then re-runs with the same provider key, so nothing is applied twice
    // at the provider.
    logger.error({ err: safeErrorFields(err) }, "could not store idempotent response");
  }
  send(res, outcome);
}
