"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

type IdleWarningDialogProps = {
  onStay: () => void;
  onSignOut: () => void;
};

/** Modal warning shown at 28 idle minutes. Focus is trapped between its two actions. */
export function IdleWarningDialog({ onStay, onSignOut }: IdleWarningDialogProps) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    stayRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onStay();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const next = document.activeElement === stayRef.current ? signOutRef.current : stayRef.current;
    next?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/60 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-description"
        onKeyDown={handleKeyDown}
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-[0_24px_48px_-12px_rgb(20_17_15/0.45)]"
      >
        <p className="eyebrow text-ember-700">Inactivity</p>
        <h2 id="idle-title" className="mt-1 font-display text-xl text-ink-950">
          Are you still there?
        </h2>
        <p id="idle-description" className="mt-2 text-sm text-muted">
          For security you'll be signed out in 2 minutes unless you choose to stay.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={signOutRef} type="button" onClick={onSignOut} className="btn btn-quiet">
            Sign out now
          </button>
          <button ref={stayRef} type="button" onClick={onStay} className="btn btn-primary">
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
