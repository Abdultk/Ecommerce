"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CheckoutIntent, ShippingMethod, ShippingOption } from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";
import { useAddresses } from "@/lib/account";
import { usePreferences } from "@/lib/account-settings";
import { addressToValues } from "@/lib/address-form";
import { useGovernorateName } from "@/lib/use-governorate-name";
import { useCart } from "@/lib/cart";
import { createCheckoutIntent, createIdempotencyKeys, fetchShippingQuote } from "@/lib/checkout";
import { errorMessage } from "@/lib/orders";
import { choiceInput, defaultChoice, paymentChoices } from "@/lib/payment-choices";
import { useAuth } from "@/lib/use-auth";
import { CheckoutStepper } from "./CheckoutStepper";
import { CheckoutSummary } from "./CheckoutSummary";
import { ContactAddressForm, type ContactDetails } from "./ContactAddressForm";
import { PaymentMethodForm } from "./PaymentMethodForm";
import { PaymentStep } from "./PaymentStep";
import type { Navigate } from "./RedirectPayment";
import { ShippingOptions, useShippingText } from "./ShippingOptions";
import { StepSection } from "./StepSection";
import { useCheckoutTask } from "./use-checkout-task";

type Step = "address" | "shipping" | "payment";
const ORDER: readonly Step[] = ["address", "shipping", "payment"];

const stepState = (step: Step, current: Step) => {
  const diff = ORDER.indexOf(step) - ORDER.indexOf(current);
  return diff === 0 ? "current" : diff < 0 ? "done" : "todo";
};

function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-[var(--radius-tile)] bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
    >
      {message}
    </p>
  );
}

function ContactSummary({ contact }: { contact: ContactDetails | null }) {
  const governorate = useGovernorateName();
  if (!contact) return null;
  const a = contact.shippingAddress;
  return (
    <p>
      {contact.email}
      <br />
      {a.fullName}, {a.line1}, {a.city}, {governorate(a.region)} {a.postalCode} ·{" "}
      <bdi>{a.phone}</bdi>
    </p>
  );
}

function EmptyCart() {
  const t = useTranslations("Checkout");
  return (
    <div className="tile-bg grid place-items-center gap-4 rounded-[var(--radius-pan)] px-6 py-12 text-center">
      <p className="font-display text-2xl">{t("emptyTitle")}</p>
      <Link href="/shop" className="btn btn-primary">
        {t("browse")}
      </Link>
    </div>
  );
}

/** Address → shipping → payment. Prices always come from the API, never the browser. */
export function CheckoutFlow({ navigate }: { navigate?: Navigate }) {
  const t = useTranslations("Checkout");
  const shippingText = useShippingText();
  const { user, ready } = useAuth();
  const storeConfig = useStoreConfig();
  const choices = paymentChoices(storeConfig);
  const cart = useCart();
  const addresses = useAddresses();
  const [keys] = useState(createIdempotencyKeys);
  const task = useCheckoutTask();

  const [step, setStep] = useState<Step>("address");
  const [moved, setMoved] = useState(false);
  const [contact, setContact] = useState<ContactDetails | null>(null);
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const prefs = usePreferences();
  // What the customer picked here wins; otherwise their saved default, when it is on offer.
  const [methodChoice, setMethod] = useState<ShippingMethod | null>(null);
  const [payChoice, setPayWith] = useState<string | null>(null);
  const savedShipping = prefs.data?.preferredShipping;
  const savedPayment = prefs.data?.preferredPayment;
  const method: ShippingMethod =
    methodChoice ??
    (savedShipping && options.some((o) => o.method === savedShipping)
      ? savedShipping
      : (options[0]?.method ?? "standard"));
  const payWith = defaultChoice(choices, payChoice, savedPayment);
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);

  const goTo = (next: Step) => {
    task.setError(null);
    setMoved(true);
    setIntent(null);
    setStep(next);
  };

  async function handleContact(details: ContactDetails) {
    const quote = await task.run(() => fetchShippingQuote(details.shippingAddress));
    if (!quote) return;
    setContact(details);
    setOptions(quote);
    if (methodChoice && !quote.some((o) => o.method === methodChoice)) setMethod(null);
    goTo("shipping");
  }

  async function placeOrder() {
    if (!contact || !cart.data || !payWith) return;
    const input = { ...contact, shippingMethod: method, ...choiceInput(payWith) };
    const key = keys.keyFor(input, cart.data);
    const created = await task.run(() =>
      createCheckoutIntent(input, key).catch((err: unknown) => {
        keys.reset(); // only a rejected request: a retry gets a fresh key, not a 409
        throw err;
      }),
    );
    if (created) setIntent(created);
  }

  if (cart.isPending || !ready || (user && (addresses.isPending || prefs.isPending))) {
    return (
      <div aria-busy="true" className="space-y-4">
        <span className="sr-only">{t("loading")}</span>
        <div className="skeleton h-64" />
      </div>
    );
  }
  if (cart.isError) return <ErrorAlert message={errorMessage(cart.error)} />;
  // A placed transfer order replaces the steps: the customer now pays from their bank.
  if (intent?.payment.kind === "bank_transfer" || intent?.payment.kind === "manual") {
    return <PaymentStep intent={intent} email={contact?.email} />;
  }
  if (cart.data.items.length === 0 && !intent) return <EmptyCart />;

  const defaultAddress =
    contact?.shippingAddress ?? addresses.data?.find((a) => a.isDefault) ?? addresses.data?.[0];
  const chosen = options.find((o) => o.method === method);
  const { currency } = cart.data;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <CheckoutStepper currentStep={step} />
        <StepSection
          number={1}
          title={t("step.contact")}
          state={stepState("address", step)}
          focusOnActivate={moved}
          onEdit={() => goTo("address")}
          editLabel={t("changeAddress")}
          summary={<ContactSummary contact={contact} />}
        >
          <ErrorAlert message={step === "address" ? task.error : null} />
          <ContactAddressForm
            defaultEmail={contact?.email ?? user?.email ?? ""}
            defaultAddress={addressToValues(defaultAddress)}
            pending={task.pending}
            onSubmit={(details) => void handleContact(details)}
          />
        </StepSection>

        <StepSection
          number={2}
          title={t("step.shipping")}
          state={stepState("shipping", step)}
          focusOnActivate={moved}
          onEdit={() => goTo("shipping")}
          editLabel={t("changeShipping")}
          summary={
            chosen ? (
              <p>
                {shippingText.name(chosen)} ({shippingText.window(chosen)}) —{" "}
                {shippingText.price(chosen.priceCents, currency)}
              </p>
            ) : null
          }
        >
          <ShippingOptions
            options={options}
            currency={currency}
            selected={method}
            onChange={setMethod}
          />
          <button
            type="button"
            className="btn btn-primary mt-5 w-full sm:w-auto"
            onClick={() => goTo("payment")}
          >
            {t("continueToPayment")}
          </button>
        </StepSection>

        <StepSection
          number={3}
          title={t("step.payment")}
          state={stepState("payment", step)}
          focusOnActivate={moved}
        >
          <ErrorAlert message={step === "payment" ? task.error : null} />
          {intent ? (
            <div className="space-y-4">
              <PaymentStep intent={intent} navigate={navigate} />
              {intent.payment.kind === "client_secret" ? (
                <button type="button" className="btn btn-ghost" onClick={() => setIntent(null)}>
                  {t("useDifferentMethod")}
                </button>
              ) : null}
            </div>
          ) : (
            <PaymentMethodForm
              choices={choices}
              selected={payWith?.key ?? ""}
              onChange={setPayWith}
              pending={task.pending}
              onSubmit={() => void placeOrder()}
            />
          )}
        </StepSection>
      </div>

      <CheckoutSummary cart={cart.data} intentTotals={intent?.totals ?? null} />
    </div>
  );
}
