"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@hp/api-client";
import { CART_QUERY_KEY } from "@/lib/cart";
import { setCartNotice } from "@/lib/handoff";
import { errorMessage } from "@/lib/orders";

/**
 * Runs one checkout request at a time (double-clicks are ignored) and turns failures into
 * a message, except OUT_OF_STOCK, which sends the shopper back to the cart to fix it.
 */
export function useCheckoutTask() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleError(err: unknown) {
    if (err instanceof ApiClientError && err.code === "OUT_OF_STOCK") {
      setCartNotice(err.message);
      void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
      router.push("/cart");
      return;
    }
    setError(errorMessage(err));
  }

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      return await task();
    } catch (err) {
      handleError(err);
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { run, pending, error, setError };
}
