"use client";

import { useCallback, useRef } from "react";

/** Collects field elements by name so a form can focus its first invalid field. */
export function useFieldFocus<K extends string>(order: readonly K[]) {
  const elements = useRef<Partial<Record<K, HTMLElement | null>>>({});
  const fieldRef = useCallback(
    (name: K) => (el: HTMLElement | null) => {
      elements.current[name] = el;
    },
    [],
  );
  const focusFirst = (errors: Partial<Record<K, string>>) => {
    const first = order.find((name) => errors[name]);
    if (first) elements.current[first]?.focus();
  };
  return { fieldRef, focusFirst };
}
