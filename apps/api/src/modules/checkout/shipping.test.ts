import { describe, expect, it } from "vitest";
import { ShippingOption, type ShippingSettings } from "@hp/contracts";
import { shippingCents, shippingOptions } from "./shipping";

/** The Oman defaults (baisa). */
const OMAN: ShippingSettings = {
  standardCents: 2_000,
  expressCents: 5_000,
  freeShippingThresholdCents: 30_000,
  standardDays: { min: 2, max: 4 },
  expressDays: { min: 1, max: 1 },
};

describe("shipping (from store settings)", () => {
  it("offers standard and express with contract-valid options", () => {
    const options = shippingOptions(5_000, OMAN);
    options.forEach((o) => ShippingOption.parse(o));
    expect(options.map((o) => [o.method, o.priceCents, o.estimatedDays])).toEqual([
      ["standard", 2_000, { min: 2, max: 4 }],
      ["express", 5_000, { min: 1, max: 1 }],
    ]);
  });

  it("makes standard shipping free at the threshold, but never express", () => {
    expect(shippingCents("standard", 30_000, OMAN)).toBe(0);
    expect(shippingCents("standard", 29_999, OMAN)).toBe(2_000);
    expect(shippingCents("express", 1_000_000, OMAN)).toBe(5_000);
  });

  it("never makes shipping free when the threshold is off", () => {
    const noFree = { ...OMAN, freeShippingThresholdCents: null };
    expect(shippingCents("standard", 10_000_000, noFree)).toBe(2_000);
  });

  it("uses the same prices in options and in the charge", () => {
    for (const subtotal of [1_000, 30_000]) {
      for (const option of shippingOptions(subtotal, OMAN)) {
        expect(option.priceCents).toBe(shippingCents(option.method, subtotal, OMAN));
      }
    }
  });
});
