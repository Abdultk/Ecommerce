import type { RequestHandler } from "express";
import { Redis } from "ioredis";
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import { clientKey } from "./client-key";
import { AppError } from "./errors";

export type LimiterOptions = { keyPrefix: string; points: number; durationSec: number };
export type LimiterFactory = (options: LimiterOptions) => RateLimiterAbstract;

export const memoryLimiters: LimiterFactory = ({ keyPrefix, points, durationSec }) =>
  new RateLimiterMemory({ keyPrefix, points, duration: durationSec });

export function redisLimiters(redisUrl: string): { factory: LimiterFactory; redis: Redis } {
  // Fail fast instead of queueing commands while Redis is down.
  const redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  const factory: LimiterFactory = ({ keyPrefix, points, durationSec }) =>
    new RateLimiterRedis({
      storeClient: redis,
      keyPrefix,
      points,
      duration: durationSec,
      // If Redis is unreachable, fall back to a per-process limiter rather than failing open.
      insuranceLimiter: new RateLimiterMemory({
        keyPrefix: `${keyPrefix}:ins`,
        points,
        duration: durationSec,
      }),
    });
  return { factory, redis };
}

const tooMany = (res: RateLimiterRes) =>
  new AppError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.", {
    retryAfterSeconds: Math.ceil(res.msBeforeNext / 1000),
  });

/** Consumes one point per request, keyed by IP (or a custom key). */
export function rateLimit(
  limiter: RateLimiterAbstract,
  keyOf: (req: Parameters<RequestHandler>[0]) => string = (req) =>
    clientKey(req.clientIp ?? req.ip),
): RequestHandler {
  return async (req, res, next) => {
    try {
      await limiter.consume(keyOf(req));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        res.setHeader("Retry-After", String(Math.ceil(err.msBeforeNext / 1000)));
        return next(tooMany(err));
      }
      next(err);
    }
  };
}

/** For service code (e.g. per-account login throttling). Throws RATE_LIMITED when exhausted. */
export async function consumeOrThrow(limiter: RateLimiterAbstract, key: string): Promise<void> {
  try {
    await limiter.consume(key);
  } catch (err) {
    if (err instanceof RateLimiterRes) throw tooMany(err);
    throw err;
  }
}
