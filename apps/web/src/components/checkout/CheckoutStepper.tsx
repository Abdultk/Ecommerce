"use client";

import { useTranslations } from "next-intl";

type Step = "address" | "shipping" | "payment";

interface Props {
  currentStep: Step;
}

export function CheckoutStepper({ currentStep }: Props) {
  const t = useTranslations("Checkout.step");

  const steps: Array<{ id: Step; number: number; label: string }> = [
    { id: "address", number: 1, label: t("contact") },
    { id: "shipping", number: 2, label: t("shipping") },
    { id: "payment", number: 3, label: t("payment") },
  ];

  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <nav aria-label="Checkout Progress" className="mb-6">
      <ol className="flex items-center justify-between sm:justify-start sm:gap-8">
        {steps.map((step, idx) => {
          const isCurrent = step.id === currentStep;
          const isDone = idx < currentIndex;

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className="flex items-center gap-2.5 sm:gap-3"
            >
              <div
                className={`flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  isDone
                    ? "bg-forest text-flour"
                    : isCurrent
                      ? "bg-copper text-flour ring-4 ring-copper/20"
                      : "bg-crust border border-line text-smoke"
                }`}
              >
                {isDone ? (
                  <svg
                    className="size-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  step.number
                )}
              </div>
              <span
                className={`text-xs font-semibold sm:text-sm ${
                  isCurrent
                    ? "text-iron"
                    : isDone
                      ? "text-forest"
                      : "text-smoke"
                }`}
              >
                {step.label}
              </span>
              {idx < steps.length - 1 && (
                <div
                  className={`hidden h-px w-8 sm:block ${
                    idx < currentIndex ? "bg-forest" : "bg-line"
                  }`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
