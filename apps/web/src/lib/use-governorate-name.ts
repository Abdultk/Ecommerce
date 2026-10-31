"use client";

import { useTranslations } from "next-intl";
import { governorateName } from "./address-form";

/** "MA" → "Muscat" or "مسقط" by language; anything unknown falls back to the stored text. */
export function useGovernorateName(): (code: string) => string {
  const t = useTranslations("Governorates");
  return (code) => (t.has(code) ? t(code) : governorateName(code));
}
