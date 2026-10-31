import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddressBook } from "@/components/account/AddressBook";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account.addresses"))("heading") };
}

export default async function AddressesPage() {
  const t = await getTranslations("Account.addresses");
  return (
    <>
      <h1 className="mb-6 text-[length:var(--text-display)]">{t("heading")}</h1>
      <AddressBook />
    </>
  );
}
