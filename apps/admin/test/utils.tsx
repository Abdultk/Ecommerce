import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { formatMoney, type AuthSession, type CurrencyCode, type Role } from "@hp/contracts";
import type { Scheduler } from "@/lib/idle-timer";
import { SessionProvider } from "@/lib/session";
import { mockSessionFor } from "@test/mocks/accounts";
import { API } from "./server";

type RenderOptions = {
  role?: Exclude<Role, "CUSTOMER">;
  session?: AuthSession;
  bootstrap?: boolean;
};

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const session = options.session ?? (options.role ? mockSessionFor(options.role) : undefined);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider apiUrl={API} initialSession={session} bootstrap={options.bootstrap ?? false}>
        {ui}
      </SessionProvider>
    </QueryClientProvider>,
  );
}

/** Deterministic scheduler for idle-timeout tests: time only moves when advance() is called. */
export class ManualClock implements Scheduler {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    this.timers.delete(id as number);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.now = timer.at;
      timer.fn();
    }
    this.now = target;
  }
}

export const MINUTE = 60_000;

/**
 * formatMoney as Testing Library sees it: Intl separates the currency code with a no-break
 * space, and text matchers compare against whitespace-normalised DOM text.
 */
export const shownMoney = (minor: number, currency: CurrencyCode = "OMR"): string =>
  formatMoney(minor, currency).replace(/\s+/g, " ");
