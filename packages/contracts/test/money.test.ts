import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_CODES,
  CurrencyCode,
  currencyExponent,
  formatMoney,
  rescaleMinor,
} from "../src/money";

describe("CURRENCIES", () => {
  it("lists every supported currency with its ISO 4217 exponent", () => {
    expect(Object.fromEntries(CURRENCY_CODES.map((c) => [c, CURRENCIES[c].exponent]))).toEqual({
      OMR: 3,
      AED: 2,
      SAR: 2,
      QAR: 2,
      KWD: 3,
      BHD: 3,
      USD: 2,
      EUR: 2,
      GBP: 2,
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(CURRENCIES)).toBe(true);
  });

  it("parses known codes and rejects others", () => {
    expect(CurrencyCode.parse("OMR")).toBe("OMR");
    expect(CurrencyCode.safeParse("omr").success).toBe(false);
    expect(CurrencyCode.safeParse("JPY").success).toBe(false);
  });
});

describe("currencyExponent", () => {
  it.each([
    ["OMR", 3],
    ["KWD", 3],
    ["USD", 2],
  ] as const)("%s → %i", (code, exp) => {
    expect(currencyExponent(code)).toBe(exp);
  });
});

describe("formatMoney", () => {
  it("formats baisa with exactly three decimals for OMR", () => {
    const text = formatMoney(18_500, "OMR");
    expect(text).toContain("18.500");
    expect(text).not.toContain("18.5000");
  });

  it("formats zero and small baisa amounts", () => {
    expect(formatMoney(0, "OMR")).toContain("0.000");
    expect(formatMoney(5, "OMR")).toContain("0.005");
  });

  it("formats cents with two decimals for USD", () => {
    expect(formatMoney(1999, "USD", "en-US")).toBe("$19.99");
  });

  it("formats fils with three decimals for KWD", () => {
    expect(formatMoney(1_234_567, "KWD", "en-US")).toContain("1,234.567");
  });

  it("formats negative amounts (refunds)", () => {
    expect(formatMoney(-1500, "USD", "en-US")).toBe("-$15.00");
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects non-integer amount %s", (bad) => {
    expect(() => formatMoney(bad, "OMR")).toThrow(RangeError);
  });
});

describe("rescaleMinor", () => {
  it("multiplies when moving to more decimals", () => {
    expect(rescaleMinor(1999, "USD", "OMR")).toBe(19_990);
  });

  it("divides when moving to fewer decimals", () => {
    expect(rescaleMinor(18_500, "OMR", "USD")).toBe(1850);
  });

  it("rounds half up", () => {
    expect(rescaleMinor(18_505, "OMR", "USD")).toBe(1851);
    expect(rescaleMinor(18_504, "OMR", "USD")).toBe(1850);
    expect(rescaleMinor(18_506, "OMR", "USD")).toBe(1851);
  });

  it("rounds negative halves away from zero", () => {
    expect(rescaleMinor(-18_505, "OMR", "USD")).toBe(-1851);
  });

  it("returns the same amount for the same exponent", () => {
    expect(rescaleMinor(1234, "USD", "EUR")).toBe(1234);
    expect(rescaleMinor(1234, "OMR", "KWD")).toBe(1234);
  });

  it("always returns an integer", () => {
    for (let n = 0; n < 50; n += 1) {
      expect(Number.isInteger(rescaleMinor(n * 7, "BHD", "GBP"))).toBe(true);
    }
  });

  it.each([1.5, Number.NaN])("rejects non-integer amount %s", (bad) => {
    expect(() => rescaleMinor(bad, "OMR", "USD")).toThrow(RangeError);
  });

  it("rejects a result outside the safe integer range", () => {
    expect(() => rescaleMinor(Number.MAX_SAFE_INTEGER, "USD", "OMR")).toThrow(RangeError);
  });
});
