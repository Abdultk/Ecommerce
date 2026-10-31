import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SecurityPanel } from "@/components/account/settings/SecurityPanel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account.tabs"))("security") };
}

export default function SecurityPage() {
  return <SecurityPanel />;
}
