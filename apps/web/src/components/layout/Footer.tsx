import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { Category, CurrencyCode } from "@hp/contracts";
import { PaymentIcons } from "@/components/ui/PaymentIcons";
import { PHOTO_CREDITS } from "@/content/photo-credits";

type Props = { categories: readonly Category[]; currency: CurrencyCode };

const LINK = "link-slide inline-block py-1 text-flour/85 transition-colors hover:text-flour";

export function Footer({ categories, currency }: Props) {
  const t = useTranslations("Footer");
  return (
    <footer className="on-dark mt-24 bg-iron text-flour">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Link href="/" aria-label="PAISLEY art" className="inline-flex items-center gap-3 group">
            <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-md bg-white/10 p-1">
              <Image src="/logo.png" alt="PAISLEY art" width={40} height={40} className="size-full object-contain" />
            </span>
            <span className="flex flex-col">
              <span className="font-serif text-lg tracking-[0.2em] font-semibold leading-tight text-flour">PAISLEY</span>
              <span className="font-serif text-xs tracking-[0.35em] text-butter font-medium uppercase">art</span>
            </span>
          </Link>
          <p className="max-w-sm text-flour/80">{t("tagline")}</p>
        </div>
        <nav aria-label={t("categoriesLabel")}>
          <p className="mb-3 font-semibold text-butter">{t("shop")}</p>
          <ul className="space-y-1">
            {categories.map((category) => (
              <li key={category.id}>
                <Link href={`/c/${category.slug}`} className={LINK}>
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("helpLabel")}>
          <p className="mb-3 font-semibold text-butter">{t("yourAccount")}</p>
          <ul className="space-y-1">
            <li>
              <Link href="/cart" className={LINK}>
                {t("cart")}
              </Link>
            </li>
            <li>
              <Link href="/account/wishlist" className={LINK}>
                {t("wishlist")}
              </Link>
            </li>
            <li>
              <Link href="/login" className={LINK}>
                {t("signIn")}
              </Link>
            </li>
            <li>
              <Link href="/register" className={LINK}>
                {t("createAccount")}
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label={t("exploreLabel")}>
          <p className="mb-3 font-semibold text-butter">{t("exploreLabel")}</p>
          <ul className="space-y-1">
            <li>
              <Link href="/shop" className={LINK}>
                {t("shopAll")}
              </Link>
            </li>
            <li>
              <Link href="/shop?sort=popular" className={LINK}>
                {t("bestSellers")}
              </Link>
            </li>
            <li>
              <Link href="/shop?sort=newest" className={LINK}>
                {t("newArrivals")}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-flour/15 px-4 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-sm text-flour/70 sm:flex-row">
          <p className="text-center sm:text-start">
            {t("prices", {
              year: new Date().getFullYear(),
              name: t("currencyName", { code: currency }),
              code: currency,
            })}
            {PHOTO_CREDITS.length > 0 ? (
              <>
                {" "}
                <Link href="/credits" className="underline">
                  {t("photoCredits")}
                </Link>
              </>
            ) : null}
          </p>
          <PaymentIcons />
        </div>
      </div>
    </footer>
  );
}
