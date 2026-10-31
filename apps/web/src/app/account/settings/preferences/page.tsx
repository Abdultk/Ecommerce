import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PreferencesForm } from "@/components/account/settings/PreferencesForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account.tabs"))("preferences") };
}

export default function PreferencesPage() {
  return <PreferencesForm />;
}
