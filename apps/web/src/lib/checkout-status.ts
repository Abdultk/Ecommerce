"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrderStatus } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { fetchCheckoutStatus } from "./checkout";

export type StatusSource = {
  number: string;
  /** null for a signed-in owner */ token: string | null;
};

export type ReturnState =
  | { kind: "checking" }
  | { kind: "paid" }
  | { kind: "failed" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

export type PollOptions = { baseDelayMs?: number; maxDelayMs?: number; maxAttempts?: number };

export const POLL_BASE_DELAY_MS = 1_000;
export const POLL_MAX_DELAY_MS = 8_000;
/** 1 + 2 + 4 + 8 × 5 s ≈ 47 s of checking before "we'll email you". */
export const POLL_MAX_ATTEMPTS = 8;

/** Wait before poll number `attempt + 1`: doubles from the base, never above the ceiling. */
export function pollDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

const FAILED: ReadonlySet<OrderStatus> = new Set(["CANCELLED", "REFUNDED"]);

export function outcomeOf(status: OrderStatus): "paid" | "failed" | "pending" {
  if (status === "PENDING_PAYMENT") return "pending";
  return FAILED.has(status) ? "failed" : "paid";
}

const isClientError = (err: unknown): err is ApiClientError =>
  err instanceof ApiClientError && err.status >= 400 && err.status < 500;

/**
 * Never trusts the redirect back from the payment page: asks the API (which confirms with
 * the provider) until the order is settled, backing off between polls, up to a cap.
 * Network and 5xx failures count as "not yet"; a 4xx (unknown order, bad token) stops.
 */
export function useCheckoutStatus(source: StatusSource | null, options: PollOptions = {}) {
  const {
    baseDelayMs = POLL_BASE_DELAY_MS,
    maxDelayMs = POLL_MAX_DELAY_MS,
    maxAttempts = POLL_MAX_ATTEMPTS,
  } = options;
  const [state, setState] = useState<ReturnState>({ kind: "checking" });
  const [round, setRound] = useState(0);
  const number = source?.number ?? null;
  const token = source?.token ?? null;

  useEffect(() => {
    if (!number) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ kind: "checking" });

    const tick = async (attempt: number) => {
      try {
        const outcome = outcomeOf(await fetchCheckoutStatus(number, token));
        if (cancelled) return;
        if (outcome !== "pending") return setState({ kind: outcome });
      } catch (err) {
        if (cancelled) return;
        if (isClientError(err)) return setState({ kind: "error", message: err.message });
      }
      if (attempt + 1 >= maxAttempts) return setState({ kind: "pending" });
      timer = setTimeout(() => void tick(attempt + 1), pollDelay(attempt, baseDelayMs, maxDelayMs));
    };
    void tick(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [number, token, round, baseDelayMs, maxDelayMs, maxAttempts]);

  const recheck = useCallback(() => setRound((r) => r + 1), []);
  return { state, recheck };
}
