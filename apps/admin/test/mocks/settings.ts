import { StoreSettings, rescaleMinor } from "@hp/contracts";

// Mock store settings: an Omani shop in OMR (3 decimals, 1 OMR = 1000 baisa), with card
// payments and manual bank transfers. The bank details are demo values; the IBAN is
// checksum-valid (ISO 13616 mod 97) so it passes the contract's Iban schema.

export const MOCK_IBAN = "OM810180000001299123456";
const SETTINGS_SEEDED_AT = "2026-01-05T09:00:00.000Z";

export function seedSettings(): StoreSettings {
  return StoreSettings.parse({
    storeName: "Hearth & Pan",
    currency: "OMR",
    vatRateBps: 500,
    shipping: {
      standardCents: 2_000,
      expressCents: 5_000,
      freeShippingThresholdCents: 30_000,
      standardDays: { min: 2, max: 4 },
      expressDays: { min: 1, max: 1 },
    },
    payments: {
      cardEnabled: true,
      bankTransferEnabled: true,
      bankTransferHoldHours: 24,
      manualMethods: [],
      bank: {
        bankName: "Bank Muscat",
        accountName: "Hearth and Pan Trading LLC",
        accountNumber: "0001299123456",
        iban: MOCK_IBAN,
        swift: "BMUSOMRX",
        instructions: "Use your order number as the transfer reference.",
      },
    },
    updatedAt: SETTINGS_SEEDED_AT,
  });
}

/**
 * The shared sample catalog prices are USD cents; the mock store is in OMR. Rescaling keeps
 * the number of major units (34.99 → 34.990), exactly what a store currency switch does.
 */
export const toStoreMinor = (usdCents: number): number => rescaleMinor(usdCents, "USD", "OMR");
