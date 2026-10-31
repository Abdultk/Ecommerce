import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ar from "../../messages/ar.json";

type Tree = { [key: string]: string | Tree };

/** Every message as "Namespace.key.path" -> text. */
function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((all, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string"
      ? { ...all, [path]: value }
      : { ...all, ...flatten(value, path) };
  }, {});
}

// Unique names: a plural repeats its number in each branch, and Arabic has more branches.
const placeholders = (text: string) =>
  [...new Set([...text.matchAll(/\{(\w+)\}|<(\w+)>/g)].map((m) => m[1] ?? m[2]))].sort();

describe("message files", () => {
  const english = flatten(en);
  const arabic = flatten(ar);

  it("have the same keys in English and Arabic", () => {
    expect(Object.keys(arabic).sort()).toEqual(Object.keys(english).sort());
  });

  it("have no empty messages", () => {
    for (const [key, text] of [...Object.entries(english), ...Object.entries(arabic)]) {
      expect(text.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders and tags in both languages", () => {
    for (const key of Object.keys(english)) {
      expect(placeholders(arabic[key] ?? ""), key).toEqual(placeholders(english[key] ?? ""));
    }
  });

  it("write the Arabic messages in Arabic script", () => {
    // "English" (the toggle label), the language code and a message that is only placeholders
    // are the deliberate exceptions.
    const exceptions = new Set(["Language.otherName", "Language.otherCode", "Product.quickAdd.aria"]);
    for (const [key, text] of Object.entries(arabic)) {
      if (exceptions.has(key)) continue;
      expect(/[؀-ۿ]/.test(text), key).toBe(true);
    }
  });
});
