"use client";

import Link from "next/link";

type Props = { error: Error & { digest?: string }; reset: () => void };

export default function ErrorPage({ error, reset }: Props) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20" role="alert">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm opacity-80">
        This page couldn&apos;t be loaded. It is usually brief, so please try again.
      </p>
      {error.digest ? <p className="mt-2 text-xs opacity-60">Reference: {error.digest}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
