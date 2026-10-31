"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProductSummary } from "@hp/contracts";
import { WishlistButton } from "@/components/account/WishlistButton";
import { PriceTag } from "./PriceTag";
import { ProductImage } from "./ProductImage";
import { QuickAdd } from "./QuickAdd";
import { Rating } from "./Rating";

type Props = { product: ProductSummary; priority?: boolean };

export function ProductCard({ product, priority = false }: Props) {
  const tQuick = useTranslations("Product.quickAdd");

  return (
    <article className="group relative flex h-full flex-col rounded-[var(--radius-pan)] border border-transparent p-2 transition-all duration-500 ease-[var(--ease-sear)] hover:border-line hover:bg-crust/50 hover:shadow-plate">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[calc(var(--radius-pan)-0.25rem)] bg-sage-wash">
        <ProductImage
          src={product.thumbnailUrl}
          alt=""
          label={product.name}
          sizes="(min-width: 1024px) 22vw, (min-width: 640px) 33vw, 50vw"
          priority={priority}
          className="transition-transform duration-700 ease-[var(--ease-sear)] group-hover:scale-[1.04]"
        />
        {product.inStock ? null : (
          <span className="absolute start-3 top-3 rounded-full bg-iron/90 backdrop-blur-sm px-3 py-1 text-[11px] font-semibold tracking-wider text-flour uppercase">
            {tQuick("soldOut")}
          </span>
        )}
        <WishlistButton product={product} className="absolute end-3 top-3 z-10" />

        {/* Always visible on touch screens; slides up on hover or keyboard focus elsewhere. */}
        {product.inStock ? (
          <div className="absolute inset-x-3 bottom-3 z-10 translate-y-3 opacity-0 transition duration-300 ease-[var(--ease-sear)] group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
            <QuickAdd product={product} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-2 pb-2 pt-4">
        <div className="flex items-center justify-between">
          {product.brand ? (
            <p className="text-xs font-semibold uppercase tracking-wider text-smoke">
              {product.brand}
            </p>
          ) : (
            <span />
          )}
        </div>

        <h3 className="font-serif text-lg font-normal leading-snug tracking-tight text-iron">
          <Link
            href={`/p/${product.slug}`}
            className="after:absolute after:inset-0 after:rounded-[var(--radius-pan)] after:content-[''] focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>

        <Rating average={product.ratingAvg} reviews={product.ratingCount} />

        <div className="mt-auto pt-2 border-t border-line/40">
          <PriceTag priceCents={product.fromPriceCents} from />
        </div>
      </div>
    </article>
  );
}
