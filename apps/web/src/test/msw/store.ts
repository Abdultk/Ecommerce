import { http, HttpResponse } from "msw";
import { BankDetails, PublicStoreConfig, ok, type ShippingOption } from "@hp/contracts";
import type { MockStore } from "./state";

// Store settings the mock API answers with: an Omani shop (OMR, 3 decimals), both payment
// methods on, and the Phase 3b default shipping rates and VAT.

export const MOCK_STORE_CONFIG: PublicStoreConfig = PublicStoreConfig.parse({
  storeName: "Hearth & Pan",
  currency: "OMR",
  vatRateBps: 500,
  freeShippingThresholdCents: 30_000,
  paymentMethods: ["card", "bank_transfer"],
  manualMethods: [],
});

/** Example account only (checksum-valid IBAN that belongs to no one). */
export const MOCK_BANK: BankDetails = BankDetails.parse({
  bankName: "Bank Muscat",
  accountName: "Hearth and Pan LLC",
  accountNumber: "0123 4567 8901 2345",
  iban: "OM510180001234567890123",
  swift: "BMUSOMRX",
  instructions: "Use the order number as the transfer reference.",
});

export const MOCK_TRANSFER_HOLD_HOURS = 24;
const HOUR_MS = 3_600_000;

const STANDARD_CENTS = 2_000;
const EXPRESS_CENTS = 5_000;

export const transferDueAt = (from: Date): string =>
  new Date(from.getTime() + MOCK_TRANSFER_HOLD_HOURS * HOUR_MS).toISOString();

/** VAT on (subtotal − discount), rounded half up like the API. */
export const vatFor = (taxableCents: number): number =>
  Math.round((taxableCents * MOCK_STORE_CONFIG.vatRateBps) / 10_000);

export function shippingOptions(goodsCents: number): ShippingOption[] {
  const threshold = MOCK_STORE_CONFIG.freeShippingThresholdCents;
  const free = threshold !== null && goodsCents >= threshold;
  return [
    {
      method: "standard",
      label: "Standard",
      priceCents: free ? 0 : STANDARD_CENTS,
      estimatedDays: { min: 2, max: 4 },
    },
    {
      method: "express",
      label: "Express",
      priceCents: EXPRESS_CENTS,
      estimatedDays: { min: 1, max: 1 },
    },
  ];
}

export function createStoreHandlers(store: MockStore) {
  return [http.get(`${store.baseUrl}/store`, () => HttpResponse.json(ok(MOCK_STORE_CONFIG)))];
}
