import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatMoney, type Category, type PublicStoreConfig } from "@hp/contracts";
import { CartButton } from "@/components/cart/CartButton";
import { HeartIcon } from "@/components/ui/Icons";
import { AccountMenu } from "./AccountMenu";
import { LanguageToggle } from "./LanguageToggle";
import { Logo } from "./Logo";
import { MobileMenu } from "./MobileMenu";
import { SearchBox } from "./SearchBox";
import { SiteNav } from "./SiteNav";
import { StickyHeader } from "./StickyHeader";

import { AnnouncementBar } from "./AnnouncementBar";

type Props = { categories: readonly Category[]; storeConfig: PublicStoreConfig };

export function Header({ categories, storeConfig }: Props) {
  const t = useTranslations("Header");
  // Only claims the store can stand behind: its own free-shipping rule and where it delivers.
  const threshold = storeConfig.freeShippingThresholdCents;
  const shipping =
    threshold === null
      ? null
      : t("freeShippingOver", { amount: formatMoney(threshold, storeConfig.currency) });
  return (
    <StickyHeader>
      <AnnouncementBar freeShippingText={shipping} />
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 transition-[padding] duration-300 ease-[var(--ease-sear)] group-data-[scrolled=true]/header:py-1.5 xl:gap-x-6">
        <MobileMenu categories={categories} />
        <Logo />
        <SiteNav categories={categories} />
        {/* One search box: full width under the bar on phones, beside the nav on desktop. */}
        <div className="order-last w-full xl:order-none xl:ms-auto xl:w-72">
          <SearchBox />
        </div>
        <div className="ms-auto flex items-center gap-1 xl:ms-0">
          <Link
            href="/account/wishlist"
            aria-label="Wishlist"
            className="hidden size-11 place-items-center rounded-md text-iron transition-colors hover:bg-parchment sm:grid"
          >
            <HeartIcon width={22} height={22} />
          </Link>
          <LanguageToggle />
          <AccountMenu />
          <CartButton />
        </div>
      </div>
    </StickyHeader>
  );
}
