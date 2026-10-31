"use client";

import { useEffect } from "react";
import Link from "next/link";

type Props = { error: Error & { digest?: string }; reset: () => void };

export default function ErrorPage({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-20">
      <div
        role="alert"
        className="space-y-4 rounded-[var(--radius-pan)] bg-crust p-10 text-center shadow-[var(--shadow-plate)]"
      >
        <p className="stamp justify-center">Kitchen mishap</p>
        <h1 className="text-[length:var(--text-display)]">Something boiled over.</h1>
        <p className="text-smoke">
          We couldn&apos;t load this page. It&apos;s usually brief — please try again.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-smoke">Reference: {error.digest}</p>
        ) : null}
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <Link href="/" className="btn btn-ghost">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
