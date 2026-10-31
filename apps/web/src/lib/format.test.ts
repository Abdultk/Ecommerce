import { describe, expect, it } from "vitest";
import {
  discountPercent,
  formatDueDateTime,
  formatRating,
  minorToMajorInput,
  parseMajorAmount,
} from "./format";

describe("price inputs (store currency)", () => {
  it("turns typed major units into minor units with the currency's decimals", () => {
    expect(parseMajorAmount("18.5", "OMR")).toBe(18_500);
    expect(parseMajorAmount("18.125", "OMR")).toBe(18_125);
    expect(parseMajorAmount(" 25 ", "USD")).toBe(2_500);
    expect(parseMajorAmount("49.99", "USD")).toBe(4_999);
  });

  it("treats blank as no limit and rejects malformed or too-precise input", () => {
    expect(parseMajorAmount("", "OMR")).toBeUndefined();
    expect(parseMajorAmount("abc", "OMR")).toBe("invalid");
    expect(parseMajorAmount("1.2345", "OMR")).toBe("invalid");
    expect(parseMajorAmount("1.234", "USD")).toBe("invalid");
    expect(parseMajorAmount("99999999999", "USD")).toBe("invalid");
  });

  it("shows minor units back as a plain major-unit number", () => {
    expect(minorToMajorInput(18_500, "OMR")).toBe("18.5");
    expect(minorToMajorInput(4_999, "USD")).toBe("49.99");
    expect(minorToMajorInput(undefined, "OMR")).toBe("");
  });
});

describe("formatDueDateTime", () => {
  it("shows a deadline in Muscat time with the zone named", () => {
    const text = formatDueDateTime("2026-10-13T09:00:00.000Z");
    expect(text).toContain("Oct 13");
    expect(text).toContain("1:00");
    expect(text).toMatch(/GMT\+4/);
  });
});

describe("discountPercent", () => {
  it("returns the rounded percentage saved against the compare-at price", () => {
    expect(discountPercent(21900, 25900)).toBe(15);
  });

  it("returns null when there is no real discount", () => {
    expect(discountPercent(3499, null)).toBeNull();
    expect(discountPercent(3499, 3499)).toBeNull();
    expect(discountPercent(3499, 2000)).toBeNull();
  });
});

describe("formatRating", () => {
  it("renders one decimal place", () => {
    expect(formatRating(4.8)).toBe("4.8");
    expect(formatRating(5)).toBe("5.0");
  });
});
