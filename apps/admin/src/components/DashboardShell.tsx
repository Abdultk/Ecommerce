"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { roleLabel } from "@/lib/format";
import { browserScheduler, type Scheduler } from "@/lib/idle-timer";
import { useSession, type SignOutReason } from "@/lib/session";
import { useIdleTimeout } from "@/lib/use-idle-timeout";
import { IdleWarningDialog } from "./IdleWarningDialog";
import { SessionGuard } from "./SessionGuard";
import { Sidebar } from "./Sidebar";

type DashboardShellProps = {
  children: ReactNode;
  /** Injected in tests to drive the idle timer. */
  scheduler?: Scheduler;
};

export function DashboardShell({ children, scheduler = browserScheduler }: DashboardShellProps) {
  const { status, user, signOut } = useSession();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = useCallback(
    async (reason: SignOutReason) => {
      await signOut(reason);
      router.replace("/login");
    },
    [signOut, router],
  );

  const onIdle = useCallback(() => void handleSignOut("idle"), [handleSignOut]);
  const { isWarning, stayActive } = useIdleTimeout({
    enabled: status === "authenticated",
    onTimeout: onIdle,
    scheduler,
  });

  return (
    <SessionGuard>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside
          id="admin-sidebar"
          className={[
            "fixed inset-y-0 left-0 z-40 w-64 flex-col bg-ink-950 text-ink-200 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-auto",
            menuOpen ? "flex shadow-2xl" : "hidden",
          ].join(" ")}
        >
          <div className="flex items-center gap-2.5 border-b border-ink-800 px-5 py-4">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded bg-ember-600 font-display text-sm text-white"
            >
              H
            </span>
            <span className="font-display text-[1.05rem] leading-tight text-white">
              PAISLEY art
              <span className="block font-sans text-[0.7rem] tracking-[0.14em] text-ink-400 uppercase">
                Admin
              </span>
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
          <p className="border-t border-ink-800 px-5 py-3 text-[0.7rem] text-ink-400">
            Phase 2 · catalog, orders, people
          </p>
        </aside>
        {menuOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 bg-ink-950/50 lg:hidden"
            onClick={() => setMenuOpen(false)}
          />
        )}

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6">
            <button
              type="button"
              className="btn btn-quiet lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="admin-sidebar"
              onClick={() => setMenuOpen((o) => !o)}
            >
              Menu
            </button>
            <div className="ml-auto flex items-center gap-3">
              {user && (
                <p className="text-right text-sm leading-tight">
                  <span className="block font-medium text-ink-950">
                    {user.firstName} {user.lastName}
                  </span>
                  <span className="text-xs text-muted">{roleLabel(user.role)}</span>
                </p>
              )}
              <Link href="/profile" className="btn btn-quiet">
                Profile
              </Link>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => void handleSignOut("manual")}
              >
                Sign out
              </button>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      {isWarning && (
        <IdleWarningDialog onStay={stayActive} onSignOut={() => void handleSignOut("manual")} />
      )}
    </SessionGuard>
  );
}
