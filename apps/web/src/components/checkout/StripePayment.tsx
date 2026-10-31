"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
// /pure has no import side effect: Stripe.js is fetched by loadStripe(), not on module load.
import { loadStripe } from "@stripe/stripe-js/pure";
// Type-only (erased at build): importing the main entry for values would load Stripe.js.
import type { Stripe } from "@stripe/stripe-js";
import type { CheckoutIntent } from "@hp/contracts";
import { checkoutReturnUrl } from "@/lib/checkout";
import { clearStashedOrder, stashPendingOrderForRedirect } from "@/lib/handoff";

const stripePromises = new Map<string, Promise<Stripe | null>>();

/** Loads Stripe.js once per key, and only when a real payment step renders. */
function stripeFor(publishableKey: string): Promise<Stripe | null> {
  let promise = stripePromises.get(publishableKey);
  if (!promise) {
    promise = loadStripe(publishableKey);
    stripePromises.set(publishableKey, promise);
  }
  return promise;
}

type Props = { intent: CheckoutIntent; clientSecret: string; publishableKey: string };

export function StripePayment({ intent, clientSecret, publishableKey }: Props) {
  return (
    <Elements
      stripe={stripeFor(publishableKey)}
      options={{ clientSecret, appearance: { theme: "stripe" } }}
    >
      <PayForm intent={intent} />
    </Elements>
  );
}

function PayForm({ intent }: { intent: CheckoutIntent }) {
  const t = useTranslations("Checkout.payment");
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    // Stripe reloads the page on success; the return page takes the token back out of storage.
    stashPendingOrderForRedirect({
      orderNumber: intent.orderNumber,
      lookupToken: intent.lookupToken,
    });
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: checkoutReturnUrl(window.location.origin, intent.orderNumber),
      },
    });
    // Reached only on an immediate failure; success redirects to return_url.
    clearStashedOrder();
    setError(result.error?.message ?? t("fallbackError"));
    setSubmitting(false);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <PaymentElement />
      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="btn btn-primary w-full"
        data-testid="pay-now"
      >
        {submitting ? t("processing") : t("payNow")}
      </button>
      <div className="flex items-center justify-center gap-2 pt-2 text-xs text-smoke">
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
