import { z } from "zod";
import { Cents, IsoDateTime } from "./common";
import { CurrencyCode } from "./money";
import { TotpCode } from "./auth";

// ---------- Payment methods ----------
// Defined here (not in orders.ts) so orders.ts can import BankDetails without an import cycle.

/** "manual" = any admin-defined offline method (cash on delivery, wallet, another bank…). */
export const PAYMENT_METHODS = ["card", "bank_transfer", "manual"] as const;
export const PaymentMethod = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

// ---------- IBAN ----------

/*
 * Omani IBAN: 23 characters = "OM" + 2 check digits + 3-digit bank code + 16-character
 * account number (CBO pads it with leading zeros).
 * Sources: Central Bank of Oman, "CBO IBAN Guidelines – Circular 30July23"
 * (https://cbo.gov.om/SiteCollectionDocuments/CBO%20IBAN%20Guidelines%20%E2%80%93%20Circular%2030July23.pdf)
 * and BankDhofar's IBAN page (https://bankdhofar.com/iban/), both stating a length of 23.
 * The SWIFT IBAN Registry entry itself was not checked directly. We therefore validate
 * the country prefix, the length, the character classes and the ISO 13616 mod-97 checksum.
 */
const OMAN_IBAN_PATTERN = /^OM\d{2}\d{3}[0-9A-Z]{16}$/;
const MOD97_CHUNK = 9;

/** ISO 13616 / ISO 7064 mod 97-10: true when the IBAN's check digits are correct. */
export function isValidIbanChecksum(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  if (!/^\d+$/.test(digits)) return false;
  // Piecewise remainder keeps every intermediate value well inside Number precision.
  let remainder = 0;
  for (let i = 0; i < digits.length; i += MOD97_CHUNK) {
    remainder = Number(`${remainder}${digits.slice(i, i + MOD97_CHUNK)}`) % 97;
  }
  return remainder === 1;
}

/** Omani IBAN; accepts spaces and lower case, yields the compact upper-case form. */
export const Iban = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .regex(OMAN_IBAN_PATTERN, "Enter an Omani IBAN: OM followed by 21 characters.")
      .refine(isValidIbanChecksum, "This IBAN's check digits are wrong. Check it for typos."),
  );

// ---------- Bank details ----------

const SWIFT_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const MAX_BANK_INSTRUCTIONS = 500;

export const BankDetails = z.object({
  bankName: z.string().trim().min(1, "Required.").max(100),
  accountName: z.string().trim().min(1, "Required.").max(100),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z -]{4,34}$/, "Enter the account number."),
  iban: Iban,
  swift: z
    .string()
    .trim()
    .toUpperCase()
    .regex(SWIFT_PATTERN, "Enter an 8- or 11-character SWIFT/BIC code.")
    .optional(),
  instructions: z.string().trim().max(MAX_BANK_INSTRUCTIONS).optional(),
});
export type BankDetails = z.infer<typeof BankDetails>;

// ---------- Store settings ----------

export const MAX_VAT_RATE_BPS = 2500;
export const MIN_TRANSFER_HOLD_HOURS = 1;
export const MAX_TRANSFER_HOLD_HOURS = 168;
const MAX_DELIVERY_DAYS = 60;

export const StoreName = z.string().trim().min(1, "Required.").max(100);
/** VAT in basis points: 500 = 5%. */
export const VatRateBps = z.number().int().min(0).max(MAX_VAT_RATE_BPS);

const Days = z.number().int().positive().max(MAX_DELIVERY_DAYS);
export const DayRange = z
  .object({ min: Days, max: Days })
  .refine((r) => r.min <= r.max, { path: ["max"], message: "Must be at least the minimum." });
export type DayRange = z.infer<typeof DayRange>;

const ShippingFields = z.object({
  standardCents: Cents,
  expressCents: Cents,
  /** Free standard shipping at or above this subtotal; null turns it off. */
  freeShippingThresholdCents: Cents.nullable(),
  standardDays: DayRange,
  expressDays: DayRange,
});

export const ShippingSettings = ShippingFields;
export type ShippingSettings = z.infer<typeof ShippingSettings>;

const HoldHours = z.number().int().min(MIN_TRANSFER_HOLD_HOURS).max(MAX_TRANSFER_HOLD_HOURS);

// ---------- Manual (admin-defined) payment methods ----------

export const MAX_MANUAL_METHODS = 10;
const MAX_MANUAL_LABEL = 60;
const MAX_MANUAL_INSTRUCTIONS = 500;

/**
 * A payment method the admin defines: the customer places the order, follows the
 * instructions, and the admin confirms the payment by hand (same flow as a bank transfer).
 */
export const ManualMethod = z.object({
  /** Stable slug, chosen once; orders keep a snapshot of label and instructions. */
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, numbers and dashes.")
    .max(40),
  label: z.string().trim().min(1, "Required.").max(MAX_MANUAL_LABEL),
  instructions: z.string().trim().min(1, "Required.").max(MAX_MANUAL_INSTRUCTIONS),
  enabled: z.boolean(),
});
export type ManualMethod = z.infer<typeof ManualMethod>;

/** What a customer sees of a manual method. */
export const PublicManualMethod = ManualMethod.pick({ id: true, label: true, instructions: true });
export type PublicManualMethod = z.infer<typeof PublicManualMethod>;

export const ManualMethods = z
  .array(ManualMethod)
  .max(MAX_MANUAL_METHODS)
  .refine((list) => new Set(list.map((m) => m.id)).size === list.length, {
    message: "Each payment method needs its own id.",
  });

type PaymentRuleInput = {
  cardEnabled?: boolean;
  bankTransferEnabled?: boolean;
  manualMethods?: readonly ManualMethod[];
  bank?: BankDetails | null;
};

/** Rules that hold for the stored settings and for the fields a patch does send. */
function checkPaymentRules(p: PaymentRuleInput, ctx: z.RefinementCtx): void {
  const noManual = p.manualMethods !== undefined && !p.manualMethods.some((m) => m.enabled);
  if (p.cardEnabled === false && p.bankTransferEnabled === false && noManual) {
    ctx.addIssue({
      code: "custom",
      path: ["cardEnabled"],
      message: "Keep at least one payment method enabled.",
    });
  }
  if (p.bankTransferEnabled === true && p.bank === null) {
    ctx.addIssue({
      code: "custom",
      path: ["bank"],
      message: "Add bank details to accept bank transfers.",
    });
  }
}

export const PaymentSettings = z
  .object({
    cardEnabled: z.boolean(),
    bankTransferEnabled: z.boolean(),
    /** How long stock is held for an unpaid transfer or manual-method order. */
    bankTransferHoldHours: HoldHours,
    /** Admin-defined offline methods; each can be switched on or off on its own. */
    manualMethods: ManualMethods,
    bank: BankDetails.nullable(),
  })
  .superRefine(checkPaymentRules);
export type PaymentSettings = z.infer<typeof PaymentSettings>;

/** GET /admin/settings */
export const StoreSettings = z.object({
  storeName: StoreName,
  currency: CurrencyCode,
  vatRateBps: VatRateBps,
  shipping: ShippingSettings,
  payments: PaymentSettings,
  updatedAt: IsoDateTime,
});
export type StoreSettings = z.infer<typeof StoreSettings>;

/** GET /store (public, cacheable). Lists only the enabled payment methods. */
export const PublicStoreConfig = z.object({
  storeName: z.string(),
  currency: CurrencyCode,
  vatRateBps: VatRateBps,
  freeShippingThresholdCents: Cents.nullable(),
  paymentMethods: z.array(PaymentMethod).min(1),
  /** The enabled admin-defined methods, shown under "manual" at checkout. */
  manualMethods: z.array(PublicManualMethod),
});
export type PublicStoreConfig = z.infer<typeof PublicStoreConfig>;

// ---------- Admin settings writes ----------

const atLeastOneField = (p: Record<string, unknown>) =>
  Object.values(p).some((v) => v !== undefined);
const CHANGE_SOMETHING = "Change at least one field.";

/** PATCH /admin/settings/general */
export const SettingsGeneralPatch = z
  .object({ storeName: StoreName.optional(), vatRateBps: VatRateBps.optional() })
  .strict()
  .refine(atLeastOneField, CHANGE_SOMETHING);
export type SettingsGeneralPatch = z.infer<typeof SettingsGeneralPatch>;

/** PATCH /admin/settings/shipping: only the fields sent change; day ranges are sent whole. */
export const SettingsShippingPatch = ShippingFields.partial()
  .strict()
  .refine(atLeastOneField, CHANGE_SOMETHING);
export type SettingsShippingPatch = z.infer<typeof SettingsShippingPatch>;

/**
 * PATCH /admin/settings/payments. Send `bank` only when it changes: whenever it is sent,
 * `totpCode` is required (step-up, so a stolen session cannot redirect customer payments).
 * The API re-checks the payment rules against the merged settings with PaymentSettings.
 */
export const SettingsPaymentsPatch = z
  .object({
    cardEnabled: z.boolean().optional(),
    bankTransferEnabled: z.boolean().optional(),
    bankTransferHoldHours: HoldHours.optional(),
    /** The whole list, sent whenever any manual method is added, edited, removed or toggled. */
    manualMethods: ManualMethods.optional(),
    bank: BankDetails.nullable().optional(),
    totpCode: TotpCode.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const { totpCode: _totp, ...changes } = p;
    if (!atLeastOneField(changes)) ctx.addIssue({ code: "custom", message: CHANGE_SOMETHING });
    if ((p.bank !== undefined || p.manualMethods !== undefined) && p.totpCode === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["totpCode"],
        message: "Enter your 2FA code to change bank details or payment methods.",
      });
    }
    checkPaymentRules(p, ctx);
  });
export type SettingsPaymentsPatch = z.infer<typeof SettingsPaymentsPatch>;

/**
 * PUT /admin/settings/currency. `confirm` is the typed confirmation and must equal
 * `currency`. 409 CURRENCY_LOCKED once any order exists.
 */
export const CurrencyChangeInput = z
  .object({ currency: CurrencyCode, confirm: z.string(), totpCode: TotpCode })
  .strict()
  .refine((c) => c.confirm === c.currency, {
    path: ["confirm"],
    message: "Type the currency code exactly to confirm.",
  });
export type CurrencyChangeInput = z.infer<typeof CurrencyChangeInput>;
