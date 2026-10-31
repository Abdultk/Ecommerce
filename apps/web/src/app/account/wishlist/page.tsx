import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WishlistView } from "@/components/account/WishlistView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Account.wishlist"))("heading") };
}

export default async function WishlistPage() {
  const t = await getTranslations("Account.wishlist");
  return (
    <>
      <h1 className="mb-6 text-[length:var(--text-display)]">{t("heading")}</h1>
      <WishlistView />
    </>
  );
}
