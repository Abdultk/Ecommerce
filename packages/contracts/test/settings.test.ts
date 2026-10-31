import { describe, expect, it } from "vitest";
import {
  BankDetails,
  CurrencyChangeInput,
  Iban,
  ManualMethod,
  ManualMethods,
  PaymentSettings,
  PublicStoreConfig,
  SettingsGeneralPatch,
  SettingsPaymentsPatch,
  SettingsShippingPatch,
  ShippingSettings,
  StoreSettings,
  isValidIbanChecksum,
} from "../src/settings";

// Check digits computed with the ISO 13616 mod-97 algorithm.
const VALID_IBAN = "OM590180000000123456789";
const NOW = "2026-10-13T08:00:00Z";

const bank = {
  bankName: "Bank Muscat",
  accountName: "Hearth & Pan LLC",
  accountNumber: "0123456789",
  iban: VALID_IBAN,
  swift: "bmusomrx",
};

/** A sample admin-defined method, as a test fixture only. */
const cod = {
  id: "cash-on-delivery",
  label: "Cash on delivery",
  instructions: "Pay the courier in cash when your order arrives.",
  enabled: true,
};

const shipping = {
  standardCents: 2000,
  expressCents: 5000,
  freeShippingThresholdCents: 30_000,
  standardDays: { min: 2, max: 4 },
  expressDays: { min: 1, max: 1 },
};

const payments = {
  cardEnabled: true,
  bankTransferEnabled: true,
  bankTransferHoldHours: 24,
  manualMethods: [],
  bank,
};

describe("Iban", () => {
  it.each([VALID_IBAN, "OM40018ABC0000123456789"])("accepts %s", (iban) => {
    expect(Iban.parse(iban)).toBe(iban);
  });

  it("strips spaces and upper-cases", () => {
    expect(Iban.parse(" om59 0180 0000 0012 3456 789 ")).toBe(VALID_IBAN);
  });

  it.each([
    ["a wrong check digit", "OM580180000000123456789"],
    ["a transposed digit", "OM590180000000123456798"],
    ["another country", "GB82WEST12345698765432"],
    ["a short IBAN", "OM5901800000001234567"],
    ["a long IBAN", "OM5901800000001234567890"],
    ["a letter in the bank code", "OM59A180000000123456789"],
    ["punctuation", "OM59-0180000000123456789"],
  ])("rejects %s", (_label, iban) => {
    expect(Iban.safeParse(iban).success).toBe(false);
  });

  it("exposes the raw mod-97 check", () => {
    expect(isValidIbanChecksum("GB82WEST12345698765432")).toBe(true);
    expect(isValidIbanChecksum("GB83WEST12345698765432")).toBe(false);
    expect(isValidIbanChecksum("GB82-WEST12345698765432")).toBe(false);
  });
});

describe("BankDetails", () => {
  it("normalises SWIFT to upper case and keeps optional fields optional", () => {
    expect(BankDetails.parse(bank).swift).toBe("BMUSOMRX");
    const { swift: _swift, ...rest } = bank;
    expect(BankDetails.parse(rest).swift).toBeUndefined();
  });

  it.each([
    ["an invalid SWIFT", { swift: "BM" }],
    ["long instructions", { instructions: "x".repeat(501) }],
    ["an empty bank name", { bankName: " " }],
    ["a bad IBAN", { iban: "OM000180000000123456789" }],
  ])("rejects %s", (_label, patch) => {
    expect(BankDetails.safeParse({ ...bank, ...patch }).success).toBe(false);
  });
});

describe("ShippingSettings", () => {
  it("accepts the Oman defaults", () => {
    expect(ShippingSettings.parse(shipping)).toEqual(shipping);
  });

  it("allows no free-shipping threshold", () => {
    expect(
      ShippingSettings.safeParse({ ...shipping, freeShippingThresholdCents: null }).success,
    ).toBe(true);
  });

  it("rejects a day range whose min exceeds max", () => {
    const result = ShippingSettings.safeParse({ ...shipping, standardDays: { min: 5, max: 2 } });
    expect(result.success).toBe(false);
  });
});

describe("PaymentSettings", () => {
  it("accepts card and transfer together", () => {
    expect(PaymentSettings.parse(payments).bankTransferHoldHours).toBe(24);
  });

  it("requires at least one payment method", () => {
    const result = PaymentSettings.safeParse({
      ...payments,
      cardEnabled: false,
      bankTransferEnabled: false,
    });
    expect(result.success).toBe(false);
  });

  it("requires bank details for bank transfer", () => {
    expect(PaymentSettings.safeParse({ ...payments, bank: null }).success).toBe(false);
    expect(
      PaymentSettings.safeParse({ ...payments, bank: null, bankTransferEnabled: false }).success,
    ).toBe(true);
  });

  it.each([0, 169, 1.5])("rejects a hold of %s hours", (hours) => {
    expect(PaymentSettings.safeParse({ ...payments, bankTransferHoldHours: hours }).success).toBe(
      false,
    );
  });
});

describe("StoreSettings and PublicStoreConfig", () => {
  const settings = {
    storeName: "Hearth & Pan",
    currency: "OMR",
    vatRateBps: 500,
    shipping,
    payments,
    updatedAt: NOW,
  };

  it("parses the full settings", () => {
    expect(StoreSettings.parse(settings).currency).toBe("OMR");
  });

  it.each([-1, 2501, 5.5])("rejects a VAT rate of %s bps", (vatRateBps) => {
    expect(StoreSettings.safeParse({ ...settings, vatRateBps }).success).toBe(false);
  });

  it("parses the public config and needs a payment method", () => {
    const config = {
      storeName: "Hearth & Pan",
      currency: "OMR",
      vatRateBps: 500,
      freeShippingThresholdCents: 30_000,
      paymentMethods: ["card", "bank_transfer"],
      manualMethods: [],
    };
    expect(PublicStoreConfig.parse(config).paymentMethods).toHaveLength(2);
    expect(PublicStoreConfig.safeParse({ ...config, paymentMethods: [] }).success).toBe(false);
  });
});

describe("settings patches", () => {
  it("general: needs at least one known field", () => {
    expect(SettingsGeneralPatch.parse({ vatRateBps: 0 })).toEqual({ vatRateBps: 0 });
    expect(SettingsGeneralPatch.safeParse({}).success).toBe(false);
    expect(SettingsGeneralPatch.safeParse({ currency: "USD" }).success).toBe(false);
  });

  it("shipping: partial, but still checks day ranges", () => {
    expect(SettingsShippingPatch.parse({ expressCents: 4000 })).toEqual({ expressCents: 4000 });
    expect(SettingsShippingPatch.safeParse({}).success).toBe(false);
    expect(SettingsShippingPatch.safeParse({ expressDays: { min: 3, max: 1 } }).success).toBe(
      false,
    );
  });

  it("payments: rejects disabling every method when the manual list is sent too", () => {
    const none = { cardEnabled: false, bankTransferEnabled: false, totpCode: "123456" };
    expect(SettingsPaymentsPatch.safeParse({ ...none, manualMethods: [] }).success).toBe(false);
    expect(
      SettingsPaymentsPatch.safeParse({ ...none, manualMethods: [{ ...cod, enabled: false }] })
        .success,
    ).toBe(false);
    expect(SettingsPaymentsPatch.safeParse({ ...none, manualMethods: [cod] }).success).toBe(true);
  });

  it("payments: leaves the 'keep one method' rule to the API when no manual list is sent", () => {
    expect(
      SettingsPaymentsPatch.safeParse({ cardEnabled: false, bankTransferEnabled: false }).success,
    ).toBe(true);
  });

  it("payments: requires a 2FA code whenever the manual methods are sent", () => {
    expect(SettingsPaymentsPatch.safeParse({ manualMethods: [cod] }).success).toBe(false);
    expect(
      SettingsPaymentsPatch.safeParse({ manualMethods: [cod], totpCode: "123456" }).success,
    ).toBe(true);
  });

  it("manual methods: need a slug id, a label and instructions, with unique ids", () => {
    const parses = (m: object) => ManualMethod.safeParse({ ...cod, ...m }).success;
    expect(parses({})).toBe(true);
    expect(parses({ id: "Cash On Delivery" })).toBe(false);
    expect(parses({ label: " " })).toBe(false);
    expect(parses({ instructions: "" })).toBe(false);
    expect(ManualMethods.safeParse([cod, cod]).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ ...cod, id: `method-${i}` }));
    expect(ManualMethods.safeParse(eleven).success).toBe(false);
  });

  it("public config carries only the enabled methods' id, label and instructions", () => {
    const config = {
      storeName: "PAISLEY art",
      currency: "OMR",
      vatRateBps: 500,
      freeShippingThresholdCents: null,
      paymentMethods: ["manual"],
      manualMethods: [{ id: cod.id, label: cod.label, instructions: cod.instructions }],
    };
    expect(PublicStoreConfig.parse(config).manualMethods).toHaveLength(1);
    expect(PublicStoreConfig.safeParse({ ...config, manualMethods: undefined }).success).toBe(
      false,
    );
  });

  it("payments: rejects enabling transfer while clearing the bank", () => {
    expect(
      SettingsPaymentsPatch.safeParse({ bankTransferEnabled: true, bank: null, totpCode: "123456" })
        .success,
    ).toBe(false);
  });

  it("payments: requires a 2FA code whenever bank details are sent", () => {
    expect(SettingsPaymentsPatch.safeParse({ bank }).success).toBe(false);
    expect(SettingsPaymentsPatch.safeParse({ bank, totpCode: "12345" }).success).toBe(false);
    expect(SettingsPaymentsPatch.parse({ bank, totpCode: "123456" }).totpCode).toBe("123456");
  });

  it("payments: toggles need no 2FA code", () => {
    expect(SettingsPaymentsPatch.parse({ cardEnabled: true })).toEqual({ cardEnabled: true });
    expect(SettingsPaymentsPatch.safeParse({}).success).toBe(false);
  });
});

describe("CurrencyChangeInput", () => {
  it("accepts a matching typed confirmation", () => {
    const input = { currency: "USD", confirm: "USD", totpCode: "123456" };
    expect(CurrencyChangeInput.parse(input)).toEqual(input);
  });

  it("rejects a confirmation that does not match", () => {
    const result = CurrencyChangeInput.safeParse({
      currency: "USD",
      confirm: "OMR",
      totpCode: "123456",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["confirm"]);
  });

  it("requires the 2FA code", () => {
    expect(CurrencyChangeInput.safeParse({ currency: "USD", confirm: "USD" }).success).toBe(false);
  });
});
