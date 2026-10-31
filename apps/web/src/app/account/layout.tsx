import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { AccountGuard } from "@/components/account/AccountGuard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Account");
  return {
    title: { default: t("title"), template: `%s | ${t("title")} | PAISLEY art` },
    robots: { index: false },
  };
}

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-10">
      <AccountGuard>{children}</AccountGuard>
    </div>
  );
}
