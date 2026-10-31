"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalProps = {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** "drawer" slides in from the right edge; "dialog" is centred. */
  variant?: "dialog" | "drawer";
  /** alertdialog for destructive confirmations. */
  role?: "dialog" | "alertdialog";
  /** Wider body for forms and tables. */
  size?: "md" | "lg";
};

/**
 * Modal dialog or drawer: focus moves inside on open, Tab is trapped, Escape and
 * the backdrop close it, and focus returns to the opener on close.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  variant = "dialog",
  role = "dialog",
  size = "md",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const ids = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const isDrawer = variant === "drawer";
  return (
    <div
      className={[
        "fixed inset-0 z-50 flex bg-ink-950/60 backdrop-blur-[2px]",
        isDrawer ? "justify-end" : "items-center justify-center p-4",
      ].join(" ")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={description ? `${ids}-desc` : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={[
          "flex max-h-full flex-col overflow-hidden border border-line bg-surface shadow-[0_24px_48px_-12px_rgb(20_17_15/0.45)] outline-none",
          isDrawer
            ? "h-full w-full max-w-xl"
            : `w-full rounded-lg ${size === "lg" ? "max-w-3xl" : "max-w-md"}`,
        ].join(" ")}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={`${ids}-title`} className="font-display text-xl text-ink-950">
              {title}
            </h2>
            {description && (
              <p id={`${ids}-desc`} className="mt-1 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            <span aria-hidden>×</span>
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
