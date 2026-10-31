"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { CheckoutIntent } from "@hp/contracts";
import { safePaymentRedirect } from "@/lib/checkout";
import { ALLOW_LOCAL_PAYMENT_PAGE, IS_PRODUCTION } from "@/lib/env";
import { stashPendingOrderForRedirect } from "@/lib/handoff";

export type Navigate = (url: string) => void;

const assignLocation: Navigate = (url) => window.location.assign(url);

type Props = { intent: CheckoutIntent; url: string; navigate?: Navigate };

/**
 * Card payment on the provider's hosted page. A top-level navigation (not fetch or a form
 * post), so the CSP needs no new connect-src or form-action entry. The lookup token waits
 * in this tab's sessionStorage for /checkout/return; it never goes into a URL.
 */
export function RedirectPayment({ intent, url, navigate = assignLocation }: Props) {
  const t = useTranslations("Checkout.payment");
  const checkout = useTranslations("Checkout");
  const target = safePaymentRedirect(url, IS_PRODUCTION && !ALLOW_LOCAL_PAYMENT_PAGE);
  const started = useRef(false);

  useEffect(() => {
    if (!target || started.current) return;
    started.current = true;
    stashPendingOrderForRedirect({
      orderNumber: intent.orderNumber,
      lookupToken: intent.lookupToken,
    });
    navigate(target);
  }, [target, intent.orderNumber, intent.lookupToken, navigate]);

  if (!target) {
    return (
      <p
        role="alert"
        className="rounded-[var(--radius-tile)] bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
      >
        {t("redirectFailed", { orderNumber: intent.orderNumber })}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-3">
        <span aria-hidden="true" className="skeleton inline-block size-5 rounded-full" />
        {t("redirecting")}
      </p>
      <a href={target} className="btn btn-primary">
        {checkout("continueToPayment")}
      </a>
    </div>
  );
}
