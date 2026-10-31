import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { intlLocale, type Locale } from "@/i18n/config";
import type { Category, ProductSummary, PublicStoreConfig } from "@hp/contracts";
import { formatMoney } from "@hp/contracts";
import { ProductGrid } from "@/components/catalog/ProductGrid";
import { ProductImage } from "@/components/catalog/ProductImage";
import { Rating } from "@/components/catalog/Rating";
import Magnet from "@/components/fx/Magnet";
import { LazyParallax as Parallax, LazySplitText as SplitText } from "@/components/fx/lazy";
import { ArrowIcon } from "@/components/ui/Icons";
import { paymentMethodNames } from "@/lib/payment-choices";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** A product shown as a photograph with its name and price underneath, linking to its page. */
function PhotoCaption({
  product,
  config,
  className,
  frame,
  sizes,
  priority = false,
  stacked = false,
}: {
  product: ProductSummary;
  config: PublicStoreConfig;
  className?: string;
  frame: string;
  sizes: string;
  priority?: boolean;
  /** Name above price, for narrow columns where they would not fit side by side. */
  stacked?: boolean;
}) {
  return (
    <Link href={`/p/${product.slug}`} className={`group block ${className ?? ""}`}>
      <span className={`relative block overflow-hidden rounded-sm bg-sage-wash ${frame}`}>
        <ProductImage
          src={product.thumbnailUrl}
          alt=""
          label={product.name}
          sizes={sizes}
          priority={priority}
          className="transition-transform duration-700 ease-[var(--ease-sear)] group-hover:scale-[1.04]"
        />
      </span>
      <span
        className={`mt-3 flex gap-x-4 ${stacked ? "flex-col gap-y-0.5" : "items-baseline justify-between"}`}
      >
        <span className="font-display text-xl leading-tight">{product.name}</span>
        <span className="shrink-0 text-smoke">
          {formatMoney(product.fromPriceCents, config.currency)}
        </span>
      </span>
    </Link>
  );
}

/**
 * First product with a photo from each distinct category, so the opening shows variety.
 * `exclude` keeps it from repeating the product the page spotlights further down.
 */
export function pickHeroProducts(
  products: readonly ProductSummary[],
  count: number,
  exclude?: string,
) {
  const picked: ProductSummary[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    if (!product.thumbnailUrl || product.slug === exclude || seen.has(product.categorySlug)) {
      continue;
    }
    seen.add(product.categorySlug);
    picked.push(product);
    if (picked.length === count) break;
  }
  return picked;
}

/** Opening: a large headline set against two real photographs at different scales. */
export function Hero({
  products,
  config,
}: {
  products: readonly ProductSummary[];
  config: PublicStoreConfig;
}) {
  const t = useTranslations("Home");
  const [large, small] = products;
  return (
    <section aria-labelledby="hero-heading" className="bg-flour">
      <div className="mx-auto grid max-w-7xl gap-x-10 gap-y-12 px-4 pb-20 pt-12 lg:grid-cols-12 lg:pb-28 lg:pt-20">
        <div className="flex flex-col justify-center lg:col-span-5">
          <h1
            id="hero-heading"
            className="text-[length:clamp(2.5rem,0.9rem+4.6vw,5.5rem)] text-forest"
          >
            <span className="hero-line" style={stagger(0)}>
              {t("heroLine1")}
            </span>
            <span className="hero-line" style={stagger(1)}>
              {t("heroLine2")}
            </span>
          </h1>
          <p className="hero-copy mt-8 max-w-md text-lg text-smoke" style={stagger(0)}>
            {t("heroCopy")}
          </p>
          <div className="hero-copy mt-8 flex flex-wrap items-center gap-x-8 gap-y-3" style={stagger(1)}>
            <Magnet padding={48} magnetStrength={5}>
              <Link href="/shop" className="btn btn-primary text-base">
                {t("explore")} <ArrowIcon />
              </Link>
            </Magnet>
            <Link href="#craft" className="link-underline font-semibold">
              {t("howWeChoose")}
            </Link>
          </div>
        </div>
        {large ? (
          <div className="hero-piece lg:col-span-4 lg:col-start-7" style={stagger(0)}>
            <PhotoCaption
              product={large}
              config={config}
              frame="aspect-[4/5]"
              sizes="(min-width: 1024px) 33vw, 100vw"
              priority
            />
          </div>
        ) : null}
        {small ? (
          <div className="hero-piece hidden lg:col-span-2 lg:block lg:pt-40" style={stagger(1)}>
            <PhotoCaption
              product={small}
              config={config}
              frame="aspect-square"
              sizes="17vw"
              stacked
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Shop facts taken from the store's own settings: nothing here the shop cannot back. */
export function TrustStrip({ config }: { config: PublicStoreConfig }) {
  const t = useTranslations("Home");
  const header = useTranslations("Header");
  const product = useTranslations("Product");
  const footer = useTranslations("Footer");
  const locale = useLocale() as Locale;
  const methods = new Intl.ListFormat(intlLocale(locale), { type: "disjunction" }).format(
    paymentMethodNames(config, (m) => product(`method.${m}`)),
  );
  const threshold = config.freeShippingThresholdCents;
  const facts: Array<{ key: string; text: string; icon: ReactNode }> = [];
  if (threshold !== null) {
    facts.push({
      key: "shipping",
      text: header("freeShippingOver", { amount: formatMoney(threshold, config.currency) }),
      icon: (
        <svg className="size-4 shrink-0 text-butter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      ),
    });
  }
  facts.push(
    {
      key: "delivery",
      text: header("deliveryAcrossOman"),
      icon: (
        <svg className="size-4 shrink-0 text-butter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      ),
    },
    {
      key: "payment",
      text: product("payBy", { methods }),
      icon: (
        <svg className="size-4 shrink-0 text-butter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      ),
    },
    {
      key: "currency",
      text: t("pricesIn", { name: footer("currencyName", { code: config.currency }) }),
      icon: (
        <svg className="size-4 shrink-0 text-butter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
          <path d="M12 6v12" />
        </svg>
      ),
    },
  );

  return (
    <section aria-label={t("trustLabel")} className="bg-forest text-flour">
      <ul className="mx-auto flex max-w-7xl flex-wrap justify-between gap-x-10 gap-y-2.5 px-4 py-4 text-[0.875rem]">
        {facts.map((fact) => (
          <li key={fact.key} className="flex items-center gap-2.5 font-medium tracking-wide">
            {fact.icon}
            <span>{fact.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Photo for a category: a photographed product in it or in any of its sub-collections. The
 * least popular one is used, so the tiles don't repeat the best sellers shown just below.
 */
function photoFor(category: Category, products: readonly ProductSummary[]) {
  const slugs = new Set([category.slug, ...category.children.map((c) => c.slug)]);
  return products.findLast((p) => p.thumbnailUrl && slugs.has(p.categorySlug)) ?? null;
}

const TILE_LAYOUT = [
  "lg:col-span-5 lg:row-span-2",
  "lg:col-span-4",
  "lg:col-span-3",
  "lg:col-span-4",
  "lg:col-span-3",
];

/** The tall lead tile's photograph drifts against the scroll; the others stay still. */
function TileImage({ drift, children }: { drift: boolean; children: ReactNode }) {
  return drift ? <Parallax shift={5}>{children}</Parallax> : <>{children}</>;
}

/** Real categories as photographs of real products in them, in an uneven grid. */
export function CategoryTiles({
  categories,
  products,
}: {
  categories: readonly Category[];
  products: readonly ProductSummary[];
}) {
  const t = useTranslations("Home");
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-20">
      <h2
        id="categories-heading"
        className="reveal mb-10 max-w-xl text-[length:var(--text-display)]"
      >
        {t("categoriesHeading")}
      </h2>
      <ul className="reveal-stagger grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-12">
        {categories.map((category, index) => {
          const product = photoFor(category, products);
          const tall = index === 0;
          return (
            <li
              key={category.id}
              style={stagger(index)}
              className={`col-span-2 sm:col-span-1 ${index === 0 ? "sm:col-span-2" : ""} ${TILE_LAYOUT[index % TILE_LAYOUT.length]}`}
            >
              <Link href={`/c/${category.slug}`} className="group flex h-full flex-col">
                <span
                  className={`relative block flex-1 overflow-hidden rounded-sm bg-forest ${
                    tall ? "min-h-96 lg:min-h-[34rem]" : "aspect-[4/3] lg:aspect-auto lg:min-h-64"
                  }`}
                >
                  {product ? (
                    <TileImage drift={tall}>
                      <ProductImage
                        src={product.thumbnailUrl}
                        alt=""
                        label={product.name}
                        sizes={tall ? "(min-width: 1024px) 42vw, 100vw" : "(min-width: 1024px) 33vw, 50vw"}
                        className="transition-transform duration-700 ease-[var(--ease-sear)] group-hover:scale-[1.04]"
                      />
                    </TileImage>
                  ) : null}
                </span>
                <span className="mt-3 flex items-baseline justify-between gap-4">
                  <span className="font-display text-2xl leading-tight">{category.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-sm text-smoke">
                    {t("collections", {
                      count: category.children.length,
                      n: category.children.length,
                    })}
                    <ArrowIcon className="size-4 text-copper transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A heading, a link and a row of real product cards. */
export function ProductRail({
  id,
  title,
  href,
  linkLabel,
  products,
  emptyText,
}: {
  id: string;
  title: string;
  href: string;
  linkLabel: string;
  products: readonly ProductSummary[];
  emptyText: string;
}) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-7xl px-4 py-14">
      <div className="reveal mb-8 flex flex-wrap items-end justify-between gap-4">
        <h2 id={id} className="text-[length:var(--text-display)]">
          {title}
        </h2>
        <Link href={href} className="link-underline font-semibold">
          {linkLabel}
        </Link>
      </div>
      {products.length > 0 ? (
        <div className="reveal">
          <ProductGrid products={products} />
        </div>
      ) : (
        <p className="rounded-md bg-crust p-8 text-center text-smoke">{emptyText}</p>
      )}
    </section>
  );
}

/** One real product with its photograph running to the page edge: the most popular right now. */
export function Spotlight({
  product,
  config,
}: {
  product: ProductSummary;
  config: PublicStoreConfig;
}) {
  const t = useTranslations("Home");
  return (
    <section aria-labelledby="spot-heading" className="bg-parchment">
      <div className="grid lg:grid-cols-2">
        <div className="relative min-h-96 overflow-hidden bg-sage-wash lg:min-h-[36rem]">
          <Parallax shift={6}>
            <ProductImage
              src={product.thumbnailUrl}
              alt=""
              label={product.name}
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
          </Parallax>
        </div>
        <div className="reveal flex flex-col justify-center gap-5 px-4 py-16 lg:px-20">
          <h2 id="spot-heading" className="text-[length:var(--text-display)]">
            <SplitText
              tag="span"
              text={t("spotlightHeading")}
              splitType="words"
              effect="rise"
              mask
              duration={0.9}
              textAlign="start"
            />
          </h2>
          <p className="font-display text-3xl">{product.name}</p>
          {product.brand ? <p className="text-smoke">{t("by", { brand: product.brand })}</p> : null}
          <Rating average={product.ratingAvg} reviews={product.ratingCount} />
          <p className="text-2xl font-semibold">
            {t("from", { price: formatMoney(product.fromPriceCents, config.currency) })}
          </p>
          <div>
            <Link href={`/p/${product.slug}`} className="btn btn-primary text-base">
              {t("details")} <ArrowIcon />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const CRAFT = ["materials", "limits", "priced"] as const;

/** Pinned story: the heading holds still while three plain statements scroll past. */
export function Craft() {
  const t = useTranslations("Home");
  return (
    <section
      id="craft"
      aria-labelledby="craft-heading"
      className="scroll-mt-24 bg-forest py-24 text-flour"
    >
      <div className="mx-auto grid max-w-7xl gap-12 px-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <h2 id="craft-heading" className="text-[length:var(--text-display)] text-flour">
            <SplitText
              tag="span"
              text={t("craftHeading")}
              splitType="words"
              effect="rise"
              mask
              duration={0.9}
              textAlign="start"
            />
          </h2>
          <p className="mt-5 max-w-md text-lg text-flour/80">{t("craftIntro")}</p>
        </div>
        <ol className="reveal-stagger space-y-14">
          {CRAFT.map((item, index) => (
            <li key={item} style={stagger(index)}>
              <h3 className="font-display text-3xl text-butter">{t(`craft.${item}.title`)}</h3>
              <p className="mt-3 max-w-lg text-lg text-flour/85">{t(`craft.${item}.text`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Every real sub-collection as a large typographic link, for shopping by what you cook with. */
export function ByPurpose({ categories }: { categories: readonly Category[] }) {
  const t = useTranslations("Home");
  const items = categories.flatMap((c) => c.children);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="purpose-heading" className="mx-auto max-w-7xl px-4 py-20">
      <h2 id="purpose-heading" className="reveal mb-10 text-[length:var(--text-display)]">
        {t("purposeHeading")}
      </h2>
      <ul className="reveal-stagger columns-1 gap-x-12 sm:columns-2 lg:columns-3">
        {items.map((item, index) => (
          <li key={item.id} style={stagger(index)} className="break-inside-avoid">
            <Link
              href={`/c/${item.slug}`}
              className="group flex min-h-14 items-center justify-between gap-4 font-display text-2xl transition-colors duration-200 hover:text-ember"
            >
              {item.name}
              <ArrowIcon className="size-5 -translate-x-2 text-copper opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
