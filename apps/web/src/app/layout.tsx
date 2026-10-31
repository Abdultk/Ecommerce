import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces, IBM_Plex_Sans_Arabic, Reem_Kufi } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, htmlLang, isLocale, localeDirection } from "@/i18n/config";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { RouteFocus } from "@/components/layout/RouteFocus";
import { Providers } from "@/components/providers/Providers";
import { serverApi } from "@/lib/server-api";
import { getCategories, orFallback } from "@/lib/catalog";
import { SITE_URL } from "@/lib/env";
import { getNonce } from "@/lib/nonce";
import { loadStoreConfig } from "@/lib/store-config-server";
import "./globals.css";

// The nonce CSP makes every page render per request. Server fetches are public catalog
// reads only (no credentials), so they stay in Next's data cache for `revalidate` seconds.
export const revalidate = 300;
export const fetchCache = "default-cache";

const DESCRIPTION =
  "Cast iron, enameled Dutch ovens, knives and kitchen tools chosen to be used hard and handed down.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "PAISLEY art — Kitchen goods built to last", template: "%s | PAISLEY art" },
  description: DESCRIPTION,
  openGraph: {
    siteName: "PAISLEY art",
    type: "website",
    locale: "en_US",
    description: DESCRIPTION,
  },
  twitter: { card: "summary" },
};

// Self-hosted at build time by next/font (no third-party request, so the CSP is unchanged).
const display = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-dmsans", display: "swap" });

// Arabic: a Kufic-influenced display face for headings (closest open-licensed match to Gulf
// signage) and a clear sans for reading text. Not preloaded, so English visitors never fetch them.
const arabicDisplay = Reem_Kufi({
  subsets: ["arabic"],
  variable: "--font-reemkufi",
  display: "swap",
  preload: false,
});
const arabicSans = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plexarabic",
  display: "swap",
  preload: false,
});

export const viewport: Viewport = { themeColor: "#243b30", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the nonce opts every route into per-request rendering; Next applies it to its scripts.
  await getNonce();
  // The header must never take the page down: no categories just means a shorter nav.
  const [categories, storeConfig, requestedLocale, messages, t] = await Promise.all([
    orFallback(getCategories(serverApi), [], "categories"),
    loadStoreConfig(),
    getLocale(),
    getMessages(),
    getTranslations("Common"),
  ]);
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;

  return (
    <html
      lang={htmlLang(locale)}
      dir={localeDirection(locale)}
      className={`${display.variable} ${sans.variable} ${arabicDisplay.variable} ${arabicSans.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <a href="#main" className="skip-link">
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers storeConfig={storeConfig}>
            <Header categories={categories} storeConfig={storeConfig} />
            <main id="main" tabIndex={-1} className="focus:outline-none">
              {children}
            </main>
            <Footer categories={categories} currency={storeConfig.currency} />
            <RouteFocus />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
