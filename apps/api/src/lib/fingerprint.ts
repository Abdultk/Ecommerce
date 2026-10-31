import { createHash } from "node:crypto";

/**
 * JSON with object keys sorted at every level, so two requests that differ only in key
 * order produce the same text. Follows JSON.stringify for undefined, Dates and arrays.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** sha256 (hex) of the canonical JSON form; used to tell a true retry from a changed request. */
export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex");
