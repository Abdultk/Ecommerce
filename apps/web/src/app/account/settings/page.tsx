import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProfileForm } from "@/components/account/ProfileForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account.tabs"))("profile") };
}

export default function SettingsPage() {
  return <ProfileForm />;
}
