import { describe, expect, it } from "vitest";
import {
  choiceInput,
  defaultChoice,
  paymentChoices,
  paymentMethodNames,
} from "./payment-choices";

// Test fixtures only: the real methods are whatever the shop admin adds.
const config = {
  paymentMethods: ["card", "bank_transfer", "manual"] as ("card" | "bank_transfer" | "manual")[],
  manualMethods: [
    { id: "cod", label: "Cash on delivery", instructions: "Pay the courier." },
    { id: "wallet", label: "Mobile wallet", instructions: "Send it to the wallet." },
  ],
};

describe("paymentChoices", () => {
  it("expands manual into one choice per admin-defined method, in order", () => {
    expect(paymentChoices(config).map((c) => c.key)).toEqual([
      "card",
      "bank_transfer",
      "manual:cod",
      "manual:wallet",
    ]);
  });

  it("offers nothing extra when manual is not enabled", () => {
    expect(paymentChoices({ paymentMethods: ["card"], manualMethods: [] })).toEqual([
      { key: "card", method: "card" },
    ]);
  });
});

describe("choiceInput", () => {
  it("sends the method id only for an admin-defined method", () => {
    const [card, , cod] = paymentChoices(config);
    expect(choiceInput(card!)).toEqual({ paymentMethod: "card" });
    expect(choiceInput(cod!)).toEqual({ paymentMethod: "manual", manualMethodId: "cod" });
  });
});

describe("defaultChoice", () => {
  const choices = paymentChoices(config);

  it("prefers the shopper's pick, then their saved method, then the first", () => {
    expect(defaultChoice(choices, "manual:wallet", "card")?.key).toBe("manual:wallet");
    expect(defaultChoice(choices, null, "bank_transfer")?.key).toBe("bank_transfer");
    expect(defaultChoice(choices, null, null)?.key).toBe("card");
  });

  it("ignores a pick or saved method the shop no longer offers", () => {
    const cardOnly = paymentChoices({ paymentMethods: ["card"], manualMethods: [] });
    expect(defaultChoice(cardOnly, "manual:gone", "bank_transfer")?.key).toBe("card");
    expect(defaultChoice([], null, null)).toBeUndefined();
  });
});

describe("paymentMethodNames", () => {
  it("names built-in methods from messages and admin-defined ones by their label", () => {
    expect(paymentMethodNames(config, (m) => `T:${m}`)).toEqual([
      "T:card",
      "T:bank_transfer",
      "Cash on delivery",
      "Mobile wallet",
    ]);
  });
});
