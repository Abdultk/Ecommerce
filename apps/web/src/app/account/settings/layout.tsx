import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { SettingsNav } from "@/components/account/settings/SettingsNav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("Account");
  return (
    <>
      <h1 className="mb-6 text-[length:var(--text-display)]">{t("settingsTitle")}</h1>
      <SettingsNav />
      {children}
    </>
  );
}
