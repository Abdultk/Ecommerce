import { describe, expect, it } from "vitest";
import {
  bpsToPercentInput,
  formatCompactMoney,
  minorToInput,
  moneyLabel,
  parseMoneyInput,
  parsePercentToBps,
} from "@/lib/money";

describe("parseMoneyInput", () => {
  it("converts OMR decimals to baisa exactly", () => {
    expect(parseMoneyInput("18.5", "OMR")).toBe(18_500);
    expect(parseMoneyInput("18.500", "OMR")).toBe(18_500);
    expect(parseMoneyInput("0.001", "OMR")).toBe(1);
    expect(parseMoneyInput("2", "OMR")).toBe(2_000);
    expect(parseMoneyInput("1,234.567", "OMR")).toBe(1_234_567);
  });

  it("never introduces float error", () => {
    // 0.1 + 0.2 style inputs and values that are inexact as binary floats.
    expect(parseMoneyInput("0.29", "USD")).toBe(29);
    expect(parseMoneyInput("1.005", "OMR")).toBe(1_005);
    expect(parseMoneyInput("4.35", "EUR")).toBe(435);
    expect(parseMoneyInput("99999.999", "KWD")).toBe(99_999_999);
  });

  it("uses each currency's exponent", () => {
    expect(parseMoneyInput("34.99", "USD")).toBe(3_499);
    expect(parseMoneyInput("34.999", "USD")).toBeNaN();
    expect(parseMoneyInput("12.345", "BHD")).toBe(12_345);
    expect(parseMoneyInput("12.3456", "OMR")).toBeNaN();
  });

  it("accepts a leading currency code and surrounding space", () => {
    expect(parseMoneyInput("  OMR 5.000 ", "OMR")).toBe(5_000);
    expect(parseMoneyInput("omr5", "OMR")).toBe(5_000);
  });

  it("returns null for blank and NaN for anything else", () => {
    expect(parseMoneyInput("", "OMR")).toBeNull();
    expect(parseMoneyInput("   ", "OMR")).toBeNull();
    expect(parseMoneyInput("abc", "OMR")).toBeNaN();
    expect(parseMoneyInput("-1", "OMR")).toBeNaN();
    expect(parseMoneyInput("1e3", "OMR")).toBeNaN();
    expect(parseMoneyInput(".5", "OMR")).toBeNaN();
    expect(parseMoneyInput("1.", "OMR")).toBeNaN();
    expect(parseMoneyInput("1234567890", "OMR")).toBeNaN();
  });
});

describe("minorToInput", () => {
  it("renders minor units with the currency's decimals", () => {
    expect(minorToInput(18_500, "OMR")).toBe("18.500");
    expect(minorToInput(5, "OMR")).toBe("0.005");
    expect(minorToInput(0, "OMR")).toBe("0.000");
    expect(minorToInput(3_499, "USD")).toBe("34.99");
    expect(minorToInput(7, "USD")).toBe("0.07");
  });

  it("returns an empty string for null and undefined", () => {
    expect(minorToInput(null, "OMR")).toBe("");
    expect(minorToInput(undefined, "OMR")).toBe("");
  });

  it("round-trips through parseMoneyInput", () => {
    for (const minor of [0, 1, 999, 1_000, 18_500, 99_999_999]) {
      expect(parseMoneyInput(minorToInput(minor, "OMR"), "OMR")).toBe(minor);
      expect(parseMoneyInput(minorToInput(minor, "USD"), "USD")).toBe(minor);
    }
  });
});

describe("formatCompactMoney", () => {
  it("abbreviates large amounts with the currency", () => {
    // Intl separates the code with a no-break space.
    expect(formatCompactMoney(1_234_500, "OMR")).toMatch(/^OMR\s1\.2K$/);
    expect(formatCompactMoney(250_000, "USD")).toMatch(/2\.5K/);
  });
});

describe("moneyLabel", () => {
  it("adds the currency code to a field label", () => {
    expect(moneyLabel("Price", "OMR")).toBe("Price (OMR)");
  });
});

describe("percent ↔ basis points", () => {
  it("parses percentages to integer bps exactly", () => {
    expect(parsePercentToBps("5")).toBe(500);
    expect(parsePercentToBps("5.25")).toBe(525);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps(" 12.5 ")).toBe(1_250);
    expect(parsePercentToBps("0.29")).toBe(29);
  });

  it("rejects junk and more than two decimals", () => {
    expect(parsePercentToBps("")).toBeNull();
    expect(parsePercentToBps("5.255")).toBeNaN();
    expect(parsePercentToBps("five")).toBeNaN();
    expect(parsePercentToBps("-1")).toBeNaN();
  });

  it("renders bps as a short percentage", () => {
    expect(bpsToPercentInput(500)).toBe("5");
    expect(bpsToPercentInput(525)).toBe("5.25");
    expect(bpsToPercentInput(550)).toBe("5.5");
    expect(bpsToPercentInput(0)).toBe("0");
  });
});
