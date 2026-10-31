"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { OrderNumber } from "@hp/contracts";
import { CART_QUERY_KEY } from "@/lib/cart";
import {
  useCheckoutStatus,
  type PollOptions,
  type ReturnState,
  type StatusSource,
} from "@/lib/checkout-status";
import { takePendingOrder } from "@/lib/handoff";
import { takeQueryParam } from "@/lib/url-secrets";
import { useAuth } from "@/lib/use-auth";

type Landing = { number: string | null; token: string | null };

function readLanding(): Landing {
  // Tokens never belong in this URL; scrub any that a hand-edited link carried, unused.
  takeQueryParam("token");
  const raw = new URLSearchParams(window.location.search).get("number");
  const number = OrderNumber.safeParse(raw).success ? raw : null;
  // Always taken, so a parked token never outlives this page.
  const handoff = takePendingOrder(number ?? "");
  return { number, token: handoff?.lookupToken ?? null };
}

function sourceFor(
  landing: Landing | null,
  ready: boolean,
  signedIn: boolean,
): StatusSource | null {
  if (!landing?.number || !ready) return null;
  if (!signedIn && !landing.token) return null;
  return { number: landing.number, token: landing.token };
}

/** Order numbers are Latin letters and digits; <bdi> keeps RTL text from reordering them. */
const mono = (chunks: ReactNode) => (
  <strong className="font-mono [unicode-bidi:isolate]">{chunks}</strong>
);

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-[var(--radius-pan)] bg-crust p-6 shadow-[var(--shadow-plate)] sm:p-10">
      <h1 className="text-[length:var(--text-display)]">{title}</h1>
      {children}
    </div>
  );
}

/**
 * Where the hosted payment page (and Stripe) send the shopper back. The redirect proves
 * nothing, so the API is asked, with backoff, until the payment is settled or we give up.
 */
export function CheckoutReturn({ poll }: { poll?: PollOptions }) {
  const t = useTranslations("Checkout.return");
  const { user, ready } = useAuth();
  const queryClient = useQueryClient();
  const [landing, setLanding] = useState<Landing | null>(null);
  // Read once per mount (the ref survives StrictMode's simulated remount).
  const read = useRef<Landing | null>(null);

  useEffect(() => {
    read.current ??= readLanding();
    setLanding(read.current);
  }, []);

  const { state, recheck } = useCheckoutStatus(sourceFor(landing, ready, Boolean(user)), poll);

  // A paid order empties the server cart; drop the cached one.
  useEffect(() => {
    if (state.kind === "paid") void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
  }, [state.kind, queryClient]);

  if (landing && ready && !sourceFor(landing, ready, Boolean(user))) {
    return (
      <Panel title={t("thanksTitle")}>
        <p>
          {t.rich("thanksBody", {
            orders: (chunks) => (
              <Link href="/account/orders" className="link-underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Panel>
    );
  }
  return (
    <ReturnView
      state={state}
      number={landing?.number ?? null}
      signedIn={Boolean(user)}
      onRecheck={recheck}
    />
  );
}

type ViewProps = {
  state: ReturnState;
  number: string | null;
  signedIn: boolean;
  onRecheck: () => void;
};

export function ReturnView({ state, number, signedIn, onRecheck }: ViewProps) {
  const t = useTranslations("Checkout.return");
  if (state.kind === "paid") return <Paid number={number} signedIn={signedIn} />;
  if (state.kind === "failed") {
    return (
      <Panel title={t("failedTitle")}>
        <p>{t.rich("failedBody", { mono, number: number ?? "" })}</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/checkout" className="btn btn-primary">
            {t("tryAgain")}
          </Link>
          <Link href="/cart" className="btn btn-ghost">
            {t("backToCart")}
          </Link>
        </div>
      </Panel>
    );
  }
  if (state.kind === "pending") {
    return (
      <Panel title={t("pendingTitle")}>
        <p role="status">{t("pendingBody")}</p>
        <button type="button" className="btn btn-ghost" onClick={onRecheck}>
          {t("checkAgain")}
        </button>
      </Panel>
    );
  }
  if (state.kind === "error") {
    return (
      <Panel title={t("errorTitle")}>
        <p role="alert" className="font-semibold text-danger">
          {state.message}
        </p>
        <Link href="/" className="btn btn-ghost">
          {t("backToShop")}
        </Link>
      </Panel>
    );
  }
  return (
    <Panel title={t("almostThere")}>
      <p role="status" aria-live="polite" className="flex items-center gap-3 text-smoke">
        <span aria-hidden="true" className="skeleton inline-block size-5 rounded-full" />
        {t("confirming")}
      </p>
    </Panel>
  );
}

function Paid({ number, signedIn }: { number: string | null; signedIn: boolean }) {
  const t = useTranslations("Checkout.return");
  return (
    <div className="tile-bg space-y-4 rounded-[var(--radius-pan)] p-6 sm:p-10">
      <p className="stamp">{t("paidStamp")}</p>
      <h1 className="text-[length:var(--text-display)]">{t("paidTitle")}</h1>
      <p>{t.rich("paidBody", { mono, number: number ?? "" })}</p>
      {signedIn && number ? (
        <Link href={`/account/orders/${number}`} className="btn btn-primary">
          {t("viewOrder")}
        </Link>
      ) : (
        <Link href="/shop" className="btn btn-primary">
          {t("keepShopping")}
        </Link>
      )}
    </div>
  );
}
