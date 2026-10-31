import type { QueryClient } from "@tanstack/react-query";
import { authStore } from "./auth-store";

/**
 * Clears every cached query (cart, orders, guest lookups) when a signed-in customer signs
 * out or a different one signs in, so nothing from one person shows for the next on a
 * shared browser. A guest signing in keeps their cart; it is merged into the account.
 */
export function clearCacheOnSessionChange(queryClient: QueryClient): () => void {
  let userId = authStore.getState().user?.id ?? null;
  return authStore.subscribe(() => {
    const next = authStore.getState().user?.id ?? null;
    if (userId !== null && next !== userId) queryClient.clear();
    userId = next;
  });
}
