"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  value: string;
  /** What is copied, e.g. "IBAN": the button reads "Copy IBAN" to assistive tech. */
  label: string;
};

type Outcome = "idle" | "copied" | "failed";

/**
 * Copies one value. The visible text stays "Copy" (the accessible name starts with it, so
 * voice control works), and the result is announced in a polite live region.
 */
export function CopyButton({ value, label }: Props) {
  const t = useTranslations("BankTransfer");
  const [outcome, setOutcome] = useState<Outcome>("idle");

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setOutcome("copied");
    } catch {
      setOutcome("failed");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-label={t("copyLabel", { what: label })}
        className="btn btn-ghost min-h-11 px-3 py-1 text-sm"
        onClick={() => void copy()}
      >
        {t("copy")}
      </button>
      <span role="status" className="text-xs font-semibold text-sage">
        {outcome === "copied" ? t("copied", { what: label }) : null}
        {outcome === "failed" ? <span className="text-danger">{t("copyFailed")}</span> : null}
      </span>
    </span>
  );
}
