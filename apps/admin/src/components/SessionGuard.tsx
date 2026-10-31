"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/session";

/** Renders children only for a signed-in admin; everyone else goes to /login. */
export function SessionGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status === "authenticated") return <>{children}</>;
  return (
    <div className="grid min-h-dvh place-items-center bg-paper">
      <p role="status" className="flex items-center gap-3 text-sm text-muted">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-ember-600" />
        {status === "loading" ? "Checking your session…" : "Redirecting to sign in…"}
      </p>
    </div>
  );
}
