"use client";

import { useTranslations } from "next-intl";
import type { PaymentChoice } from "@/lib/payment-choices";

type Props = {
  choices: readonly PaymentChoice[];
  /** The key of the selected choice. */
  selected: string;
  onChange: (key: string) => void;
  pending: boolean;
  onSubmit: () => void;
};

/** Message keys for the built-in methods' names and one-line explanations. */
const OPTION_KEYS = {
  card: { label: "card", hint: "cardHint" },
  bank_transfer: { label: "bankTransfer", hint: "bankTransferHint" },
} as const;

/** Step 3: the enabled payment methods as a native radio group, then place the order. */
export function PaymentMethodForm({ choices, selected, onChange, pending, onSubmit }: Props) {
  const t = useTranslations("Checkout.payment");
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">{t("legend")}</legend>
        {choices.map((choice) => {
          // Admin-defined methods carry their own name; their instructions wait for the next step.
          const label = choice.method === "manual" ? choice.label : t(OPTION_KEYS[choice.method].label);
          const hint =
            choice.method === "manual" ? t("manualHint") : t(OPTION_KEYS[choice.method].hint);
          return (
            <label
              key={choice.key}
              className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-tile)] border-2 border-line bg-crust p-4 has-[:checked]:border-ember"
            >
              <input
                type="radio"
                name="paymentMethod"
                value={choice.key}
                checked={selected === choice.key}
                onChange={() => onChange(choice.key)}
                aria-describedby={`payment-hint-${choice.key}`}
                className="mt-0.5 size-5 accent-ember"
              />
              <span>
                <span className="block font-semibold">{label}</span>
                <span id={`payment-hint-${choice.key}`} className="block text-sm text-smoke">
                  {hint}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? t("placing") : t("place")}
      </button>
      <div className="flex items-center gap-2 pt-2 text-xs text-smoke">
        <svg
          className="size-4 shrink-0 text-forest"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>{t("securityNotice")}</span>
      </div>
    </form>
  );
}
