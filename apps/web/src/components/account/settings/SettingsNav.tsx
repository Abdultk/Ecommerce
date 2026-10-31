"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/account/settings", key: "profile" },
  { href: "/account/settings/preferences", key: "preferences" },
  { href: "/account/settings/security", key: "security" },
  { href: "/account/settings/privacy", key: "privacy" },
] as const;

/** Sub-navigation for the settings area; the profile tab is an exact match. */
export function SettingsNav() {
  const t = useTranslations("Account");
  const pathname = usePathname();
  return (
    <nav aria-label={t("settingsTitle")} className="mb-8 overflow-x-auto">
      <ul className="flex gap-6 border-b border-line">
        {TABS.map((tab) => {
          const current = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 pb-0.5 font-semibold ${current ? "border-forest text-forest" : "border-transparent text-smoke hover:text-iron"}`}
              >
                {t(`tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
