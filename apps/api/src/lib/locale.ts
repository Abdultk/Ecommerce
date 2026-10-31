import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

/** Languages the catalog is translated into; English is the base column text. */
export type Lang = "en" | "ar";

const store = new AsyncLocalStorage<{ lang: Lang }>();

/** First language tag of Accept-Language, reduced to a supported language. */
export function langFromHeader(header: string | undefined): Lang {
  const first = header?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "ar" || first.startsWith("ar-") ? "ar" : "en";
}

/** Makes the shopper's language available to catalog and cart code without threading it through every call. */
export const localeMiddleware: RequestHandler = (req, res, next) => {
  res.vary("Accept-Language");
  store.run({ lang: langFromHeader(req.header("accept-language")) }, next);
};

export const currentLang = (): Lang => store.getStore()?.lang ?? "en";

type Translations = Record<string, Record<string, unknown>>;

const asTranslations = (value: unknown): Translations =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Translations) : {};

/** The translated text for `field` in the current language, or the English base text. */
export function localized<T extends string | null>(
  translations: unknown,
  field: string,
  base: T,
  lang: Lang = currentLang(),
): T | string {
  if (lang === "en") return base;
  const text = asTranslations(translations)[lang]?.[field];
  return typeof text === "string" && text.trim() !== "" ? text : base;
}
