import {
  BankDetails,
  DayRange,
  ManualMethods,
  MAX_TRANSFER_HOLD_HOURS,
  MAX_VAT_RATE_BPS,
  MIN_TRANSFER_HOLD_HOURS,
  StoreName,
  TotpCode,
  currencyExponent,
  type CurrencyCode,
  type PaymentSettings,
  type SettingsGeneralPatch,
  type SettingsPaymentsPatch,
  type SettingsShippingPatch,
  type ShippingSettings,
  type StoreSettings,
} from "@hp/contracts";
import { bpsToPercentInput, minorToInput, parseMoneyInput, parsePercentToBps } from "@/lib/money";

/** Field name → message. Nested payment fields use "bank.iban"-style keys. */
export type FieldErrors = Record<string, string>;

export type FormResult<P> = { ok: true; patch: P } | { ok: false; errors: FieldErrors };

const NOTHING_CHANGED = "Nothing changed.";
const WHOLE_NUMBER = /^\d+$/;
/** Mirrors MAX_DELIVERY_DAYS in packages/contracts/src/settings.ts (not exported there). */
const MAX_DELIVERY_DAYS = 60;
const DAYS_MESSAGE = `Enter a whole number of days, from 1 to ${MAX_DELIVERY_DAYS}.`;

const hasChanges = (patch: object): boolean => Object.keys(patch).length > 0;

const wholeNumber = (input: string): number => {
  const trimmed = input.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : Number.NaN;
};

const amountMessage = (currency: CurrencyCode): string => {
  const exponent = currencyExponent(currency);
  return `Enter an amount with up to ${exponent} decimals, like ${minorToInput(2 * 10 ** exponent, currency)}.`;
};

/** Required money field → minor units; undefined when it has an error (recorded in `errors`). */
function requiredAmount(
  input: string,
  currency: CurrencyCode,
  field: string,
  errors: FieldErrors,
): number | undefined {
  const value = parseMoneyInput(input, currency);
  if (value === null) errors[field] = "Required.";
  else if (Number.isNaN(value)) errors[field] = amountMessage(currency);
  else return value;
  return undefined;
}

/** Optional money field: blank → null (turned off). Undefined when it has an error. */
function optionalAmount(
  input: string,
  currency: CurrencyCode,
  field: string,
  errors: FieldErrors,
): number | null | undefined {
  const value = parseMoneyInput(input, currency);
  if (value === null) return null;
  if (Number.isNaN(value)) {
    errors[field] = amountMessage(currency);
    return undefined;
  }
  return value;
}

// ---------- General (store name, VAT) ----------

export type GeneralForm = { storeName: string; vat: string };

export function generalFormFrom(settings: StoreSettings): GeneralForm {
  return { storeName: settings.storeName, vat: bpsToPercentInput(settings.vatRateBps) };
}

const VAT_FORMAT_MESSAGE = "Enter a percentage with up to 2 decimals, like 5 or 5.25.";
const VAT_MAX_MESSAGE = `VAT can be at most ${MAX_VAT_RATE_BPS / 100}%.`;

function vatBps(input: string, errors: FieldErrors): number | undefined {
  const bps = parsePercentToBps(input);
  if (bps === null || Number.isNaN(bps)) errors.vat = VAT_FORMAT_MESSAGE;
  else if (bps > MAX_VAT_RATE_BPS) errors.vat = VAT_MAX_MESSAGE;
  else return bps;
  return undefined;
}

export function generalPatch(
  form: GeneralForm,
  settings: StoreSettings,
): FormResult<SettingsGeneralPatch> {
  const errors: FieldErrors = {};
  const name = StoreName.safeParse(form.storeName);
  if (!name.success) errors.storeName = name.error.issues[0]?.message ?? "Required.";
  const bps = vatBps(form.vat, errors);
  if (!name.success || bps === undefined) return { ok: false, errors };
  const patch: SettingsGeneralPatch = {
    ...(name.data !== settings.storeName && { storeName: name.data }),
    ...(bps !== settings.vatRateBps && { vatRateBps: bps }),
  };
  return hasChanges(patch) ? { ok: true, patch } : { ok: false, errors: { form: NOTHING_CHANGED } };
}

// ---------- Shipping ----------

export type ShippingForm = {
  standard: string;
  standardMin: string;
  standardMax: string;
  express: string;
  expressMin: string;
  expressMax: string;
  freeThreshold: string;
};

export function shippingFormFrom(settings: ShippingSettings, currency: CurrencyCode): ShippingForm {
  return {
    standard: minorToInput(settings.standardCents, currency),
    standardMin: String(settings.standardDays.min),
    standardMax: String(settings.standardDays.max),
    express: minorToInput(settings.expressCents, currency),
    expressMin: String(settings.expressDays.min),
    expressMax: String(settings.expressDays.max),
    freeThreshold: minorToInput(settings.freeShippingThresholdCents, currency),
  };
}

/** Records each day-range issue under "<field>Min" or "<field>Max". */
function dayRange(
  min: string,
  max: string,
  field: "standard" | "express",
  errors: FieldErrors,
): DayRange | undefined {
  const parsed = DayRange.safeParse({ min: wholeNumber(min), max: wholeNumber(max) });
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const key = `${field}${issue.path[0] === "max" ? "Max" : "Min"}`;
    errors[key] = issue.code === "custom" ? issue.message : DAYS_MESSAGE;
  }
  return undefined;
}

/** The shipping form always sends the whole section: the API stores it as one block. */
export function shippingPatch(
  form: ShippingForm,
  currency: CurrencyCode,
): FormResult<SettingsShippingPatch> {
  const errors: FieldErrors = {};
  const standardCents = requiredAmount(form.standard, currency, "standard", errors);
  const expressCents = requiredAmount(form.express, currency, "express", errors);
  const freeShippingThresholdCents = optionalAmount(
    form.freeThreshold,
    currency,
    "freeThreshold",
    errors,
  );
  const standardDays = dayRange(form.standardMin, form.standardMax, "standard", errors);
  const expressDays = dayRange(form.expressMin, form.expressMax, "express", errors);
  if (
    standardCents === undefined ||
    expressCents === undefined ||
    freeShippingThresholdCents === undefined ||
    !standardDays ||
    !expressDays
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    patch: { standardCents, expressCents, freeShippingThresholdCents, standardDays, expressDays },
  };
}

// ---------- Payments (methods, transfer hold, bank details) ----------

export type BankForm = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  swift: string;
  instructions: string;
};

/** One admin-defined method in the form. A new row has no id until it is saved. */
export type ManualForm = {
  id: string;
  label: string;
  instructions: string;
  enabled: boolean;
};

export type PaymentsForm = {
  cardEnabled: boolean;
  bankTransferEnabled: boolean;
  holdHours: string;
  bank: BankForm;
  manualMethods: ManualForm[];
  totpCode: string;
};

const bankFormFrom = (bank: BankDetails | null): BankForm => ({
  bankName: bank?.bankName ?? "",
  accountName: bank?.accountName ?? "",
  accountNumber: bank?.accountNumber ?? "",
  iban: bank?.iban ?? "",
  swift: bank?.swift ?? "",
  instructions: bank?.instructions ?? "",
});

export function paymentsFormFrom(payments: PaymentSettings): PaymentsForm {
  return {
    cardEnabled: payments.cardEnabled,
    bankTransferEnabled: payments.bankTransferEnabled,
    holdHours: String(payments.bankTransferHoldHours),
    bank: bankFormFrom(payments.bank),
    manualMethods: payments.manualMethods.map((m) => ({ ...m })),
    totpCode: "",
  };
}

const MAX_ID_LENGTH = 40;

/** A readable id from a method's name. A name with no Latin letters or digits becomes "method". */
export function methodIdFor(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_ID_LENGTH - 3)
      .replace(/-+$/, "") || "method";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** The list as it will be sent: new rows get their ids, kept in the order shown. */
function manualInput(rows: readonly ManualForm[]) {
  const taken = new Set(rows.map((m) => m.id).filter(Boolean));
  return rows.map((m) => {
    const id = m.id || methodIdFor(m.label, taken);
    taken.add(id);
    return { id, label: m.label.trim(), instructions: m.instructions.trim(), enabled: m.enabled };
  });
}

/** True when the admin-defined methods differ from the stored ones (a new row always counts). */
export function manualChanged(form: PaymentsForm, payments: PaymentSettings): boolean {
  const comparable = (rows: readonly ManualForm[]) =>
    JSON.stringify(
      rows.map((m) => [m.id, m.label.trim(), m.instructions.trim(), m.enabled] as const),
    );
  return comparable(form.manualMethods) !== comparable(payments.manualMethods);
}

function parseManual(rows: readonly ManualForm[], errors: FieldErrors) {
  const parsed = ManualMethods.safeParse(manualInput(rows));
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    errors[issue.path.length > 0 ? `manual.${issue.path.join(".")}` : "manual"] = issue.message;
  }
  return undefined;
}

/** The bank fields in the form they're compared in: trimmed, IBAN compact and upper case. */
function comparableBank(bank: BankForm) {
  return {
    bankName: bank.bankName.trim(),
    accountName: bank.accountName.trim(),
    accountNumber: bank.accountNumber.trim(),
    iban: bank.iban.replace(/\s+/g, "").toUpperCase(),
    swift: bank.swift.trim().toUpperCase(),
    instructions: bank.instructions.trim(),
  };
}

/** True when the bank details differ from the stored ones (formatting alone doesn't count). */
export function bankChanged(form: PaymentsForm, payments: PaymentSettings): boolean {
  return (
    JSON.stringify(comparableBank(form.bank)) !==
    JSON.stringify(comparableBank(bankFormFrom(payments.bank)))
  );
}

/** The bank form as the contract takes it: blank optional fields are left out. */
const bankInput = (bank: BankForm) => ({
  ...bank,
  swift: bank.swift.trim() || undefined,
  instructions: bank.instructions.trim() || undefined,
});

function parseBank(form: BankForm, errors: FieldErrors): BankDetails | undefined {
  const parsed = BankDetails.safeParse(bankInput(form));
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    errors[`bank.${issue.path.join(".")}`] = issue.message;
  }
  return undefined;
}

const HOLD_MESSAGE = `Enter whole hours from ${MIN_TRANSFER_HOLD_HOURS} to ${MAX_TRANSFER_HOLD_HOURS}.`;
const isHoldHours = (hours: number): boolean =>
  Number.isInteger(hours) && hours >= MIN_TRANSFER_HOLD_HOURS && hours <= MAX_TRANSFER_HOLD_HOURS;

export type PaymentsResult = (
  { ok: true; patch: SettingsPaymentsPatch } | { ok: false; errors: FieldErrors }
) & { bankChanged: boolean };

/** Only the fields that changed are sent. Bank details go with the 2FA code. */
export function paymentsPatch(form: PaymentsForm, payments: PaymentSettings): PaymentsResult {
  const changed = bankChanged(form, payments);
  const errors: FieldErrors = {};
  const holdHours = wholeNumber(form.holdHours);
  if (!isHoldHours(holdHours)) errors.holdHours = HOLD_MESSAGE;
  const bank = changed ? parseBank(form.bank, errors) : undefined;
  const methodsChanged = manualChanged(form, payments);
  const manualMethods = methodsChanged ? parseManual(form.manualMethods, errors) : undefined;
  // Changing where customers pay (bank details or any manual method) needs a fresh 2FA code.
  const totp = changed || methodsChanged ? TotpCode.safeParse(form.totpCode.trim()) : undefined;
  if (totp && !totp.success)
    errors.totpCode = "Enter the 6-digit code from your authenticator app.";
  const anyManual = form.manualMethods.some((m) => m.enabled);
  if (!form.cardEnabled && !form.bankTransferEnabled && !anyManual) {
    errors.cardEnabled = "Keep at least one payment method enabled.";
  }
  if (form.bankTransferEnabled && !changed && payments.bank === null) {
    errors.bank = "Add bank details to accept bank transfers.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors, bankChanged: changed };
  const patch: SettingsPaymentsPatch = {
    ...(form.cardEnabled !== payments.cardEnabled && { cardEnabled: form.cardEnabled }),
    ...(form.bankTransferEnabled !== payments.bankTransferEnabled && {
      bankTransferEnabled: form.bankTransferEnabled,
    }),
    ...(holdHours !== payments.bankTransferHoldHours && { bankTransferHoldHours: holdHours }),
    ...(bank && { bank }),
    ...(manualMethods && { manualMethods }),
    ...(totp?.success && { totpCode: totp.data }),
  };
  return hasChanges(patch)
    ? { ok: true, patch, bankChanged: changed }
    : { ok: false, errors: { form: NOTHING_CHANGED }, bankChanged: changed };
}
