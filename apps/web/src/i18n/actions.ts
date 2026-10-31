"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "./config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Remembers the language choice. Server actions are public endpoints, so the value is checked. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
