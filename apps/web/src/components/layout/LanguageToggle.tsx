"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/i18n/actions";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

/**
 * Switches between English and Arabic. The label is the other language's own name, set in its
 * own script and tagged with its language so screen readers pronounce it correctly.
 */
export function LanguageToggle() {
  const t = useTranslations("Language");
  const rawLocale = useLocale();
  const current: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const other: Locale = current === "ar" ? "en" : "ar";
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const switchLanguage = () => {
    startTransition(async () => {
      await setLocale(other);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={switchLanguage}
      disabled={pending}
      lang={t("otherCode")}
      aria-label={t("switchLabel")}
      className="inline-flex min-h-11 items-center rounded-md px-2 text-[0.9375rem] sm:px-3 font-semibold text-iron transition-colors hover:bg-parchment disabled:opacity-60"
    >
      {t("otherName")}
    </button>
  );
}
