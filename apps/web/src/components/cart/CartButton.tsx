"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BagIcon } from "@/components/ui/Icons";
import { cartItemCount, useCart } from "@/lib/cart";
import { useCartDrawer } from "./CartDrawerContext";

export function CartButton() {
  const t = useTranslations("Cart");
  const { data: cart } = useCart();
  const { open, isOpen } = useCartDrawer();
  const count = cartItemCount(cart);
  const previous = useRef(count);
  const [bumps, setBumps] = useState(0);

  // Each increase replays the bump, so the shopper sees the bag take the item.
  useEffect(() => {
    if (count > previous.current) setBumps((n) => n + 1);
    previous.current = count;
  }, [count]);

  return (
    <button
      type="button"
      onClick={open}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label={t("buttonLabel", { count })}
      className="relative grid size-11 place-items-center rounded-md text-iron transition-colors hover:bg-parchment"
      data-cart-trigger
    >
      <BagIcon width={24} height={24} />
      <span
        key={bumps}
        data-testid="cart-count"
        aria-hidden="true"
        className={`absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold leading-5 ${
          bumps > 0 ? "animate-bump" : ""
        } ${count > 0 ? "bg-ember text-white" : "scale-90 bg-parchment text-smoke"}`}
      >
        {count}
      </span>
    </button>
  );
}
