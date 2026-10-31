"use client";

import { lazy, Suspense } from "react";
import { useTranslations } from "next-intl";
import type { CheckoutIntent } from "@hp/contracts";
import { STRIPE_PUBLISHABLE_KEY } from "@/lib/env";
import { ManualPlaced } from "./ManualPlaced";
import { RedirectPayment, type Navigate } from "./RedirectPayment";
import { TransferPlaced } from "./TransferPlaced";
// Stripe Elements is only needed for a Stripe card payment, so it is split out of /checkout.
const StripePayment = lazy(() =>
  import("./StripePayment").then((m) => ({ default: m.StripePayment })),
);

type Props = {
  intent: CheckoutIntent;
  /** Where the receipt goes; shown on the bank-transfer confirmation. */
  email?: string;
  publishableKey?: string;
  navigate?: Navigate;
};

/**
 * After the order exists: card via the provider's hosted page (Amwal Pay, or the dev fake),
 * card via Stripe's Payment Element (card data only ever goes to Stripe), or the bank
 * details for a manual transfer.
 */
export function PaymentStep({
  intent,
  email,
  publishableKey = STRIPE_PUBLISHABLE_KEY,
  navigate,
}: Props) {
  const t = useTranslations("Checkout.payment");
  const { payment } = intent;
  if (payment.kind === "redirect") {
    return <RedirectPayment intent={intent} url={payment.redirectUrl} navigate={navigate} />;
  }
  if (payment.kind === "bank_transfer") {
    return <TransferPlaced intent={intent} transfer={payment} email={email} />;
  }
  if (payment.kind === "manual") {
    return <ManualPlaced intent={intent} payment={payment} email={email} />;
  }
  if (!publishableKey) {
    return (
      <p
        role="alert"
        className="rounded-[var(--radius-tile)] bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
      >
        {t("stripeMissing", { orderNumber: intent.orderNumber })}
      </p>
    );
  }
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="skeleton h-48">
          <span className="sr-only">{t("loadingForm")}</span>
        </div>
      }
    >
      <StripePayment
        intent={intent}
        clientSecret={payment.clientSecret}
        publishableKey={publishableKey}
      />
    </Suspense>
  );
}
