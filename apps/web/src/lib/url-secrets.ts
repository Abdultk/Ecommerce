import { useEffect, useRef, useState } from "react";

// One-time secrets (reset tokens, guest lookup tokens) arrive in links. Read them once,
// then remove them from the address bar so they never reach history, bookmarks,
// screenshots, Referer headers or analytics page views.

function replaceUrl(url: URL): void {
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Reads `?name=` from the current URL and strips it. */
export function takeQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (value === null) return null;
  url.searchParams.delete(name);
  replaceUrl(url);
  return value;
}

/** Reads `#name=` from the current URL and strips the whole fragment. */
export function takeHashParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const value = new URLSearchParams(url.hash.replace(/^#/, "")).get(name);
  if (value === null) return null;
  url.hash = "";
  replaceUrl(url);
  return value;
}

/**
 * Reads `#name=` (current email links: fragments never reach servers, logs or Referer),
 * falling back to `?name=` for links sent before the switch. Whichever is used, the
 * secret is scrubbed from both places so neither survives in history.
 */
export function takeUrlSecret(name: string): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get(name);
  const fromQuery = url.searchParams.get(name);
  if (fromHash === null && fromQuery === null) return null;
  if (fromHash !== null) url.hash = "";
  url.searchParams.delete(name);
  replaceUrl(url);
  return fromHash ?? fromQuery;
}

export type SecretLocation = "query" | "hash" | "hash-or-query";

const TAKERS: Record<SecretLocation, (name: string) => string | null> = {
  query: takeQueryParam,
  hash: takeHashParam,
  "hash-or-query": takeUrlSecret,
};

/**
 * Takes a one-time secret from the URL after mount. The ref survives React StrictMode's
 * simulated remount, so the second effect run doesn't see an already-stripped URL and
 * conclude there is no token. `undefined` means "not read yet".
 */
export function useUrlSecret(where: SecretLocation, name = "token"): string | null | undefined {
  const taken = useRef<string | null | undefined>(undefined);
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (taken.current === undefined) {
      taken.current = TAKERS[where](name);
    }
    setValue(taken.current);
  }, [where, name]);
  return value;
}
