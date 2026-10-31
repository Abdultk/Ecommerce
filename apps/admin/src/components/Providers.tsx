"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiClientError } from "@hp/api-client";
import { SessionProvider } from "@/lib/session";

const MAX_RETRIES = 2;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Client errors (4xx) won't change on retry; network and 5xx might.
        retry: (count, error) =>
          count < MAX_RETRIES &&
          !(error instanceof ApiClientError && error.status >= 400 && error.status < 500),
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
