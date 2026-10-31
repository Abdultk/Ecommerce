import type { PaymentMethod, PublicStoreConfig } from "@hp/contracts";

/** One thing a shopper can pick at checkout: card, bank transfer, or one admin-defined method. */
export type PaymentChoice =
  | { key: "card" | "bank_transfer"; method: "card" | "bank_transfer" }
  | {
      key: `manual:${string}`;
      method: "manual";
      manualMethodId: string;
      label: string;
      instructions: string;
    };

type StorePayments = Pick<PublicStoreConfig, "paymentMethods" | "manualMethods">;

/** The store's enabled methods in order, with "manual" expanded into the admin's own methods. */
export function paymentChoices(config: StorePayments): PaymentChoice[] {
  return config.paymentMethods.flatMap((method): PaymentChoice[] =>
    method === "manual"
      ? config.manualMethods.map((m) => ({
          key: `manual:${m.id}` as const,
          method: "manual" as const,
          manualMethodId: m.id,
          label: m.label,
          instructions: m.instructions,
        }))
      : [{ key: method, method }],
  );
}

/** The checkout request fields for a choice. */
export const choiceInput = (
  choice: PaymentChoice,
): { paymentMethod: PaymentMethod; manualMethodId?: string } =>
  choice.method === "manual"
    ? { paymentMethod: "manual", manualMethodId: choice.manualMethodId }
    : { paymentMethod: choice.method };

/**
 * The choice to start on: what the shopper picked, else their saved default method when the
 * shop still offers it, else the first one. A saved "manual" means the first admin-defined method.
 */
export function defaultChoice(
  choices: readonly PaymentChoice[],
  picked: string | null,
  saved: PaymentMethod | null | undefined,
): PaymentChoice | undefined {
  return (
    choices.find((c) => c.key === picked) ?? choices.find((c) => c.method === saved) ?? choices[0]
  );
}

/** Names for a "we accept …" sentence: built-in methods by `nameOf`, admin methods by label. */
export function paymentMethodNames(
  config: StorePayments,
  nameOf: (method: "card" | "bank_transfer") => string,
): string[] {
  return paymentChoices(config).map((c) => (c.method === "manual" ? c.label : nameOf(c.method)));
}
