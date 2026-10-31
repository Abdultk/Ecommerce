import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PHOTO_CREDITS, type PhotoCredit } from "@/content/photo-credits";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Credits");
  return { title: t("title"), description: t("description") };
}

const LICENSE_NAMES: Record<string, string> = {
  by: "CC BY",
  "by-sa": "CC BY-SA",
  cc0: "CC0 (public domain dedication)",
  pdm: "Public domain",
  pd: "Public domain",
};

const LICENSE_URLS: Record<string, (version?: string) => string> = {
  by: (v) => `https://creativecommons.org/licenses/by/${v ?? "4.0"}/`,
  "by-sa": (v) => `https://creativecommons.org/licenses/by-sa/${v ?? "4.0"}/`,
  cc0: () => "https://creativecommons.org/publicdomain/zero/1.0/",
};

function licenceLabel(credit: PhotoCredit): string {
  const name = LICENSE_NAMES[credit.license] ?? credit.license.toUpperCase();
  return credit.licenseVersion && credit.license.startsWith("by")
    ? `${name} ${credit.licenseVersion}`
    : name;
}

export default async function CreditsPage() {
  const t = await getTranslations("Credits");
  return (
    <div className="mx-auto max-w-4xl px-4 pb-20 pt-12">
      <h1 className="text-[length:var(--text-display)]">{t("title")}</h1>
      <p className="mt-4 max-w-2xl text-smoke">{t("intro")}</p>
      <ul className="mt-10 divide-y divide-line" hidden={PHOTO_CREDITS.length === 0}>
        {PHOTO_CREDITS.map((credit) => {
          const licenceUrl = LICENSE_URLS[credit.license]?.(credit.licenseVersion ?? undefined);
          return (
            <li key={credit.slug} className="grid gap-1 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <p className="font-semibold">{credit.product}</p>
              <p className="text-smoke">
                {t.rich("byLine", {
                  title: credit.title,
                  creator: credit.creator,
                  via: credit.via,
                  src: (chunks) => (
                    <a href={credit.source} rel="noopener noreferrer" className="underline">
                      {chunks}
                    </a>
                  ),
                  licence: licenceLabel(credit),
                  lic: (chunks) =>
                    licenceUrl ? (
                      <a href={licenceUrl} rel="noopener noreferrer" className="underline">
                        {chunks}
                      </a>
                    ) : (
                      chunks
                    ),
                })}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
