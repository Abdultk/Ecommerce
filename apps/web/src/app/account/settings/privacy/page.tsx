import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PrivacyPanel } from "@/components/account/settings/PrivacyPanel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account.tabs"))("privacy") };
}

export default function PrivacyPage() {
  return <PrivacyPanel />;
}
