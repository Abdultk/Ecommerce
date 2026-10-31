import { describe, expect, it } from "vitest";
import {
  bankChanged,
  generalFormFrom,
  generalPatch,
  manualChanged,
  methodIdFor,
  paymentsFormFrom,
  paymentsPatch,
  shippingFormFrom,
  shippingPatch,
} from "@/components/settings/settings-model";
import { MOCK_IBAN, seedSettings } from "@test/mocks/settings";

const settings = seedSettings();

describe("general settings", () => {
  it("shows VAT as a percentage and sends only changed fields in bps", () => {
    const form = generalFormFrom(settings);
    expect(form).toEqual({ storeName: "Hearth & Pan", vat: "5" });
    expect(generalPatch({ ...form, vat: "5.25" }, settings)).toEqual({
      ok: true,
      patch: { vatRateBps: 525 },
    });
    expect(generalPatch({ storeName: "Hearth and Pan", vat: "5" }, settings)).toEqual({
      ok: true,
      patch: { storeName: "Hearth and Pan" },
    });
  });

  it("reports bad VAT, empty names and unchanged forms", () => {
    expect(generalPatch({ storeName: "Hearth & Pan", vat: "5.255" }, settings)).toEqual({
      ok: false,
      errors: { vat: "Enter a percentage with up to 2 decimals, like 5 or 5.25." },
    });
    expect(generalPatch({ storeName: "Hearth & Pan", vat: "26" }, settings)).toMatchObject({
      ok: false,
      errors: { vat: "VAT can be at most 25%." },
    });
    expect(generalPatch({ storeName: " ", vat: "5" }, settings)).toMatchObject({
      ok: false,
      errors: { storeName: "Required." },
    });
    expect(generalPatch(generalFormFrom(settings), settings)).toEqual({
      ok: false,
      errors: { form: "Nothing changed." },
    });
  });
});

describe("shipping settings", () => {
  it("round-trips OMR amounts exactly", () => {
    const form = shippingFormFrom(settings.shipping, "OMR");
    expect(form).toMatchObject({ standard: "2.000", express: "5.000", freeThreshold: "30.000" });
    const result = shippingPatch({ ...form, standard: "2.345", freeThreshold: "" }, "OMR");
    expect(result).toEqual({
      ok: true,
      patch: {
        standardCents: 2_345,
        expressCents: 5_000,
        freeShippingThresholdCents: null,
        standardDays: { min: 2, max: 4 },
        expressDays: { min: 1, max: 1 },
      },
    });
  });

  it("keys errors by field", () => {
    const form = shippingFormFrom(settings.shipping, "OMR");
    const result = shippingPatch(
      { ...form, express: "5.0001", standardMin: "5", standardMax: "3" },
      "OMR",
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        express: "Enter an amount with up to 3 decimals, like 2.000.",
        standardMax: "Must be at least the minimum.",
      },
    });
  });
});

describe("payment settings", () => {
  it("leaves bank details and the 2FA code out when the bank is unchanged", () => {
    const form = paymentsFormFrom(settings.payments);
    expect(bankChanged(form, settings.payments)).toBe(false);
    expect(paymentsPatch({ ...form, holdHours: "48" }, settings.payments)).toEqual({
      ok: true,
      patch: { bankTransferHoldHours: 48 },
      bankChanged: false,
    });
  });

  it("sends the bank and the code when bank details change, normalising the IBAN", () => {
    const form = paymentsFormFrom(settings.payments);
    const spaced = MOCK_IBAN.toLowerCase().replace(/(.{4})/g, "$1 ");
    const changed = { ...form, bank: { ...form.bank, iban: spaced }, totpCode: "123456" };
    expect(bankChanged(changed, settings.payments)).toBe(false);
    const renamed = {
      ...form,
      bank: { ...form.bank, bankName: "Bank Dhofar" },
      totpCode: "123456",
    };
    const result = paymentsPatch(renamed, settings.payments);
    expect(result).toMatchObject({ ok: true, bankChanged: true });
    if (!result.ok) throw new Error("expected ok");
    expect(result.patch.bank).toMatchObject({ bankName: "Bank Dhofar", iban: MOCK_IBAN });
    expect(result.patch.totpCode).toBe("123456");
  });

  it("validates the IBAN checksum and asks for the 2FA code", () => {
    const form = paymentsFormFrom(settings.payments);
    const bad = { ...form, bank: { ...form.bank, iban: "OM820180000001299123456" } };
    expect(paymentsPatch(bad, settings.payments)).toEqual({
      ok: false,
      errors: {
        "bank.iban": "This IBAN's check digits are wrong. Check it for typos.",
        totpCode: "Enter the 6-digit code from your authenticator app.",
      },
      bankChanged: true,
    });
  });

  it("needs bank details for transfers and one enabled method", () => {
    const form = paymentsFormFrom({ ...settings.payments, bank: null, bankTransferEnabled: false });
    expect(form.bank.iban).toBe("");
    const noBank = paymentsPatch(
      { ...form, bankTransferEnabled: true },
      {
        ...settings.payments,
        bank: null,
        bankTransferEnabled: false,
      },
    );
    expect(noBank).toMatchObject({
      ok: false,
      errors: { bank: "Add bank details to accept bank transfers." },
    });
    const none = paymentsPatch(
      { ...paymentsFormFrom(settings.payments), cardEnabled: false, bankTransferEnabled: false },
      settings.payments,
    );
    expect(none).toMatchObject({
      ok: false,
      errors: { cardEnabled: "Keep at least one payment method enabled." },
    });
  });

  it("reports an unchanged form", () => {
    expect(paymentsPatch(paymentsFormFrom(settings.payments), settings.payments)).toEqual({
      ok: false,
      errors: { form: "Nothing changed." },
      bankChanged: false,
    });
  });
});

describe("admin-defined payment methods", () => {
  const base = paymentsFormFrom(settings.payments);
  const row = {
    id: "",
    label: "Cash on delivery",
    instructions: "Pay the courier.",
    enabled: true,
  };
  const withRow = { ...base, manualMethods: [row], totpCode: "123456" };

  it("sends the whole list, an id made from the name, and the 2FA code", () => {
    expect(manualChanged(withRow, settings.payments)).toBe(true);
    expect(paymentsPatch(withRow, settings.payments)).toEqual({
      ok: true,
      patch: {
        manualMethods: [
          {
            id: "cash-on-delivery",
            label: "Cash on delivery",
            instructions: "Pay the courier.",
            enabled: true,
          },
        ],
        totpCode: "123456",
      },
      bankChanged: false,
    });
  });

  it("asks for the 2FA code before saving a new method", () => {
    expect(paymentsPatch({ ...withRow, totpCode: "" }, settings.payments)).toMatchObject({
      ok: false,
      errors: { totpCode: "Enter the 6-digit code from your authenticator app." },
    });
  });

  it("needs a name and instructions for every method", () => {
    const blank = { ...base, manualMethods: [{ ...row, label: " ", instructions: "" }] };
    expect(paymentsPatch({ ...blank, totpCode: "123456" }, settings.payments)).toMatchObject({
      ok: false,
      errors: { "manual.0.label": expect.any(String), "manual.0.instructions": expect.any(String) },
    });
  });

  it("keeps ids unique and falls back to 'method' for names without Latin letters", () => {
    expect(methodIdFor("Cash on delivery!", new Set())).toBe("cash-on-delivery");
    expect(methodIdFor("Cash on delivery", new Set(["cash-on-delivery"]))).toBe(
      "cash-on-delivery-2",
    );
    expect(methodIdFor("الدفع عند الاستلام", new Set())).toBe("method");
  });

  it("lets a method be the only one enabled, but not zero", () => {
    const stored = { ...settings.payments, manualMethods: [{ ...row, id: "cod" }] };
    const form = paymentsFormFrom(stored);
    const onlyManual = { ...form, cardEnabled: false, bankTransferEnabled: false, totpCode: "" };
    expect(paymentsPatch(onlyManual, stored)).toMatchObject({ ok: true });
    const none = { ...onlyManual, manualMethods: [{ ...form.manualMethods[0]!, enabled: false }] };
    expect(paymentsPatch({ ...none, totpCode: "123456" }, stored)).toMatchObject({
      ok: false,
      errors: { cardEnabled: "Keep at least one payment method enabled." },
    });
  });

  it("does not count whitespace or an unchanged list as a change", () => {
    const stored = { ...settings.payments, manualMethods: [{ ...row, id: "cod" }] };
    const form = paymentsFormFrom(stored);
    expect(manualChanged(form, stored)).toBe(false);
    const padded = {
      ...form,
      manualMethods: [{ ...form.manualMethods[0]!, label: " Cash on delivery " }],
    };
    expect(manualChanged(padded, stored)).toBe(false);
  });
});
