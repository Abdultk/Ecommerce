"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "@/lib/session";
import { Modal } from "./Modal";

type TypedConfirmDialogProps = {
  title: string;
  description: ReactNode;
  /** The exact text the user must type, e.g. an order number or email. */
  phrase: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  /** Extra fields shown above the confirmation input (e.g. a refund amount). */
  children?: ReactNode;
  /** Blocks submission with a message when the extra fields are invalid. */
  validate?: () => string | null;
};

/** Destructive actions need the user to type a phrase before the button unlocks. */
export function TypedConfirmDialog({
  title,
  description,
  phrase,
  confirmLabel,
  onConfirm,
  onClose,
  children,
  validate,
}: TypedConfirmDialogProps) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === phrase;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    const problem = validate?.() ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} description={description} onClose={onClose} role="alertdialog">
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {children}
        <div>
          <label htmlFor={`${id}-confirm`} className="field-label">
            Type <span className="font-mono text-ink-950">{phrase}</span> to confirm
          </label>
          <input
            id={`${id}-confirm`}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            className="field font-mono"
          />
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!matches || busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
