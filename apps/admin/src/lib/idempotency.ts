"use client";

import { useState } from "react";

// One Idempotency-Key per user action. A retry of the same action (same request
// fingerprint) reuses the key, so the API can replay its first result instead of applying
// a stock adjustment or refund twice after a dropped response. Changing the input, or a
// successful request (settle), starts a new action with a fresh key.

export type IdempotencyKeys = {
  /** The key for this request; stable while the fingerprint is unchanged and unsettled. */
  keyFor(fingerprint: string): string;
  /** Call after the request succeeded: the next request is a new action. */
  settle(): void;
};

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function createIdempotencyKeys(
  generate: () => string = () => crypto.randomUUID(),
): IdempotencyKeys {
  let current: Readonly<{ fingerprint: string; key: string }> | null = null;
  return {
    keyFor(fingerprint) {
      if (current?.fingerprint !== fingerprint) current = { fingerprint, key: generate() };
      return current.key;
    },
    settle() {
      current = null;
    },
  };
}

/** Keys that live as long as the component (e.g. a dialog's open button). */
export function useIdempotencyKeys(): IdempotencyKeys {
  const [keys] = useState(() => createIdempotencyKeys());
  return keys;
}

/** Headers for a mutating request: `path` + JSON body identify the action. */
export function idempotencyHeaders(
  keys: IdempotencyKeys,
  path: string,
  body: unknown,
): Record<string, string> {
  return { [IDEMPOTENCY_HEADER]: keys.keyFor(`${path} ${JSON.stringify(body)}`) };
}
