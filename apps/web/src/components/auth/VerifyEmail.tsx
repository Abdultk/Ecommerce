"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { browserApi } from "@/lib/api";
import { errorMessage } from "@/lib/orders";
import { useUrlSecret } from "@/lib/url-secrets";

type State = { kind: "checking" } | { kind: "verified" } | { kind: "failed"; message: string };

/** Verifies once on load; the token is stripped from the URL before the request. */
export function VerifyEmail() {
  const t = useTranslations("Auth.verify");
  const token = useUrlSecret("hash-or-query");
  const [state, setState] = useState<State>({ kind: "checking" });
  // One request per mount, even when StrictMode runs the effect twice.
  const request = useRef<Promise<State> | null>(null);

  useEffect(() => {
    if (token === undefined) return;
    if (!token) {
      setState({ kind: "failed", message: t("incomplete") });
      return;
    }
    let cancelled = false;
    request.current ??= browserApi
      .post("/auth/verify-email", { token })
      .then((): State => ({ kind: "verified" }))
      .catch((err: unknown): State => ({ kind: "failed", message: errorMessage(err) }));
    void request.current.then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  if (state.kind === "checking") {
    return (
      <p role="status" aria-live="polite" className="text-smoke">
        {t("checking")}
      </p>
    );
  }
  if (state.kind === "failed") {
    return (
      <p role="alert" className="font-semibold text-danger">
        {state.message}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p role="status" className="rounded-[var(--radius-tile)] bg-sage-wash p-4">
        {t("verified")}
      </p>
      <Link href="/shop" className="btn btn-primary">
        {t("start")}
      </Link>
    </div>
  );
}
