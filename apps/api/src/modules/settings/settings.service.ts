import type { StoreSettings as SettingsRow } from "@prisma/client";
import {
  BankDetails,
  CurrencyCode,
  ManualMethods,
  type ManualMethod,
  type PaymentMethod,
  type PublicStoreConfig,
  type StoreSettings,
} from "@hp/contracts";
import type { PaymentGateway } from "../../lib/payments";
import type { DbClient } from "../../lib/prisma";

export const SETTINGS_ID = "default";
/** Amount used to ask a card provider whether it can take the store currency at all. */
const SUPPORT_PROBE_CENTS = 10_000;
const MASK_KEEP = 4;

/**
 * Loads the settings row, recreating the Oman defaults if it is missing (the migration
 * creates it; only a wiped database lacks it). Bank transfer stays off until bank details exist.
 */
export async function loadSettings(db: DbClient): Promise<SettingsRow> {
  return db.storeSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID },
    update: {},
  });
}

/**
 * Locks the settings row for the rest of the transaction. Checkout takes a shared lock and a
 * currency change an exclusive one, so no order can be placed mid-switch.
 */
export async function lockSettings(db: DbClient, mode: "share" | "update"): Promise<SettingsRow> {
  await loadSettings(db);
  if (mode === "update") {
    await db.$queryRaw`SELECT id FROM "StoreSettings" WHERE id = ${SETTINGS_ID} FOR UPDATE`;
  } else {
    await db.$queryRaw`SELECT id FROM "StoreSettings" WHERE id = ${SETTINGS_ID} FOR SHARE`;
  }
  return db.storeSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
}

/** Stored bank details, or null when unset or unreadable. */
export const bankOf = (row: Pick<SettingsRow, "bank">): BankDetails | null => {
  const parsed = BankDetails.safeParse(row.bank);
  return parsed.success ? parsed.data : null;
};

/** Stored admin-defined payment methods; an unreadable value counts as none. */
export const manualMethodsOf = (row: Pick<SettingsRow, "manualMethods">): ManualMethod[] => {
  const parsed = ManualMethods.safeParse(row.manualMethods);
  return parsed.success ? parsed.data : [];
};

export const currencyOf =(row: Pick<SettingsRow, "currency">): CurrencyCode =>
  CurrencyCode.parse(row.currency);

export function toStoreSettings(row: SettingsRow): StoreSettings {
  return {
    storeName: row.storeName,
    currency: currencyOf(row),
    vatRateBps: row.vatRateBps,
    shipping: shippingOf(row),
    payments: {
      cardEnabled: row.cardEnabled,
      bankTransferEnabled: row.bankTransferEnabled,
      bankTransferHoldHours: row.bankTransferHoldHours,
      manualMethods: manualMethodsOf(row),
      bank: bankOf(row),
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function shippingOf(row: SettingsRow): StoreSettings["shipping"] {
  return {
    standardCents: row.standardCents,
    expressCents: row.expressCents,
    freeShippingThresholdCents: row.freeShippingThresholdCents,
    standardDays: { min: row.standardDaysMin, max: row.standardDaysMax },
    expressDays: { min: row.expressDaysMin, max: row.expressDaysMax },
  };
}

/** Methods a shopper can actually use now (card only if the provider takes the currency). */
export function availableMethods(row: SettingsRow, gateway: PaymentGateway): PaymentMethod[] {
  const card = row.cardEnabled && gateway.supports(currencyOf(row), SUPPORT_PROBE_CENTS);
  const transfer = row.bankTransferEnabled && bankOf(row) !== null;
  const manual = enabledManualMethods(row).length > 0;
  return [
    ...(card ? (["card"] as const) : []),
    ...(transfer ? (["bank_transfer"] as const) : []),
    ...(manual ? (["manual"] as const) : []),
  ];
}

/** The admin-defined methods a shopper can pick now. */
export const enabledManualMethods = (row: Pick<SettingsRow, "manualMethods">): ManualMethod[] =>
  manualMethodsOf(row).filter((m) => m.enabled);

export function toPublicConfig(row: SettingsRow, gateway: PaymentGateway): PublicStoreConfig {
  return {
    storeName: row.storeName,
    currency: currencyOf(row),
    vatRateBps: row.vatRateBps,
    freeShippingThresholdCents: row.freeShippingThresholdCents,
    paymentMethods: availableMethods(row, gateway),
    manualMethods: enabledManualMethods(row).map(({ id, label, instructions }) => ({
      id,
      label,
      instructions,
    })),
  };
}

/** "OM59…6789" → "•••6789": audit entries never hold full account numbers. */
export const maskTail = (value: string): string =>
  value.length <= MASK_KEEP ? "••••" : `•••${value.slice(-MASK_KEEP)}`;

export const maskBank = (bank: BankDetails | null) =>
  bank && { ...bank, accountNumber: maskTail(bank.accountNumber), iban: maskTail(bank.iban) };

/** Settings as written to the audit log (bank numbers masked). */
export const auditSnapshot = (settings: StoreSettings) => ({
  ...settings,
  payments: { ...settings.payments, bank: maskBank(settings.payments.bank) },
});
