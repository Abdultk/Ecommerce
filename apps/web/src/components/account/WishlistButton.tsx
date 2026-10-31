"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ProductSummary } from "@hp/contracts";
import { HeartIcon } from "@/components/ui/Icons";
import { useToggleWishlist, useWishlist } from "@/lib/account";
import { errorMessage } from "@/lib/orders";
import { useAuth } from "@/lib/use-auth";

type Props = { product: Pick<ProductSummary, "id" | "name">; className?: string };

const BASE =
  "relative z-10 grid size-11 place-items-center rounded-full bg-crust/95 text-ember-deep shadow-[var(--shadow-plate)] hover:bg-ember-wash";

/** Heart toggle (aria-pressed). Signed-out shoppers get a sign-in link instead. */
export function WishlistButton({ product, className = "" }: Props) {
  const { user } = useAuth();
  const pathname = usePathname();
  const wishlist = useWishlist();
  const toggle = useToggleWishlist();

  if (!user) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className={`${BASE} ${className}`}
        aria-label={`Sign in to save ${product.name} to your wishlist`}
      >
        <HeartIcon />
      </Link>
    );
  }

  const saved = wishlist.data?.some((item) => item.productId === product.id) ?? false;
  return (
    <span className={`relative z-10 inline-flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        className={BASE}
        aria-pressed={saved}
        aria-label={`Save ${product.name} to your wishlist`}
        disabled={wishlist.isPending}
        onClick={() => toggle.mutate({ productId: product.id, saved })}
      >
        <HeartIcon filled={saved} />
      </button>
      {toggle.isError ? (
        <span
          role="alert"
          className="rounded bg-crust px-2 py-0.5 text-xs font-semibold text-danger"
        >
          {errorMessage(toggle.error)}
        </span>
      ) : null}
    </span>
  );
}
