export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** The visitor's choice, kept in a cookie so it works on every URL without moving any routes. */
export const LOCALE_COOKIE = "hp-locale";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

export const localeDirection = (locale: Locale): "ltr" | "rtl" => (locale === "ar" ? "rtl" : "ltr");

/** The BCP 47 tag for <html lang>: Arabic as written in Oman. */
export const htmlLang = (locale: Locale): string => (locale === "ar" ? "ar-OM" : "en-US");

/**
 * The Intl locale used for dates. Oman's Arabic uses Western digits (0-9) in shop contexts,
 * so Arabic dates ask for the Latin numbering system explicitly.
 */
export const intlLocale = (locale: Locale): string => (locale === "ar" ? "ar-OM-u-nu-latn" : "en-US");
