"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { z } from "zod";

export type ParamPatch = Record<string, string | number | boolean | null | undefined>;

/** Applies a patch to a query string: empty, null, undefined and false remove the key. */
export function patchSearch(current: string, patch: ParamPatch, resetPage: boolean): string {
  const next = new URLSearchParams(current);
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "" || value === false) next.delete(key);
    else next.set(key, String(value));
  });
  if (resetPage && !("page" in patch)) next.delete("page");
  return next.toString();
}

/**
 * Filters, sort and paging live in the URL so views can be bookmarked and shared.
 * Invalid values fall back to the schema's defaults instead of breaking the page.
 */
export function useUrlQuery<S extends z.ZodTypeAny>(schema: S) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const search = params.toString();

  const query = useMemo((): z.infer<S> => {
    const parsed = schema.safeParse(Object.fromEntries(new URLSearchParams(search)));
    return parsed.success ? parsed.data : schema.parse({});
  }, [schema, search]);

  /** Changing anything but the page sends the user back to page 1. */
  const update = useCallback(
    (patch: ParamPatch) => {
      const qs = patchSearch(search, patch, true);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  return { query, search, update };
}
