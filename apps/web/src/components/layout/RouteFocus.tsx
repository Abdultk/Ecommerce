"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * After a client-side navigation to a new page, move keyboard and screen-reader focus to
 * <main id="main"> (Next announces the new title but leaves focus on the old link). The
 * first render and query-only changes (filters, sort, paging) keep focus where it is.
 */
export function RouteFocus({ targetId = "main" }: { targetId?: string }) {
  const pathname = usePathname();
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.getElementById(targetId)?.focus({ preventScroll: true });
  }, [pathname, targetId]);

  return null;
}
