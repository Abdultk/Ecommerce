import type { z } from "zod";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type FormResult<T, K extends string> =
  { success: true; data: T } | { success: false; errors: FieldErrors<K> };

/** Validates FormData-like values with a Zod schema; keeps the first message per field. */
export function validateForm<S extends z.ZodTypeAny, K extends string>(
  schema: S,
  values: Record<K, string>,
): FormResult<z.infer<S>, K> {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { success: true, data: parsed.data };
  const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const errors: FieldErrors<K> = {};
  for (const key of Object.keys(values) as K[]) {
    const first = fieldErrors[key]?.[0];
    if (first) errors[key] = first;
  }
  return { success: false, errors };
}

/** Reads named string fields from a form. */
export function readFields<K extends string>(
  form: HTMLFormElement,
  names: readonly K[],
): Record<K, string> {
  const data = new FormData(form);
  return Object.fromEntries(names.map((name) => [name, String(data.get(name) ?? "")])) as Record<
    K,
    string
  >;
}

const PROBE_ORIGIN = "http://same-site.invalid";

/**
 * Only allow same-site relative redirects. Parsing (rather than prefix checks) catches the
 * tricks browsers normalise away, such as "/\t/evil.example" becoming "//evil.example".
 */
export function safeRedirect(target: string | null | undefined, fallback = "/"): string {
  if (!target?.startsWith("/")) return fallback;
  try {
    const url = new URL(target, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
