import { describe, expect, it } from "vitest";
import { langFromHeader, localized } from "./locale";

describe("langFromHeader", () => {
  it("picks Arabic from the first language tag, including regional forms", () => {
    expect(langFromHeader("ar")).toBe("ar");
    expect(langFromHeader("ar-OM,en;q=0.8")).toBe("ar");
  });

  it("falls back to English for anything else or nothing", () => {
    expect(langFromHeader(undefined)).toBe("en");
    expect(langFromHeader("en-US,ar;q=0.5")).toBe("en");
    expect(langFromHeader("arx")).toBe("en");
  });
});

describe("localized", () => {
  const translations = { ar: { name: "سكين", empty: "  " } };

  it("returns the translation for Arabic", () => {
    expect(localized(translations, "name", "Knife", "ar")).toBe("سكين");
  });

  it("returns the English base text when the language is English, or the field is missing or blank", () => {
    expect(localized(translations, "name", "Knife", "en")).toBe("Knife");
    expect(localized(translations, "material", "Steel", "ar")).toBe("Steel");
    expect(localized(translations, "empty", "Base", "ar")).toBe("Base");
  });

  it("copes with malformed translation data and keeps null base values", () => {
    expect(localized(null, "name", "Knife", "ar")).toBe("Knife");
    expect(localized([], "name", "Knife", "ar")).toBe("Knife");
    expect(localized({}, "material", null, "ar")).toBeNull();
  });
});
