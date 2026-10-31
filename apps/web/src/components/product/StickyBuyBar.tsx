"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";

type Props = { name: string; fromPriceCents: number };

/**
 * A slim bar that slides up once the buy panel has scrolled out of view on a long product
 * page. It only returns the shopper to the panel (#purchase), so there is one place where
 * variants, quantity and the cart are handled.
 */
export function StickyBuyBar({ name, fromPriceCents }: Props) {
  const t = useTranslations("Product");
  const home = useTranslations("Home");
  const { currency } = useStoreConfig();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const target = document.getElementById("purchase");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      // Visible only after scrolling past the panel, never before it has been reached.
      setShow(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!show}
      className={`fixed inset-x-0 bottom-0 z-30 bg-flour/95 px-4 py-3 shadow-[0_-12px_30px_-20px_rgb(36_38_34/0.5)] backdrop-blur transition duration-300 ease-[var(--ease-sear)] ${
        show ? "translate-y-0" : "pointer-events-none translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="text-sm text-smoke">
            {home("from", { price: formatMoney(fromPriceCents, currency) })}
          </p>
        </div>
        <a href="#purchase" tabIndex={show ? 0 : -1} className="btn btn-primary shrink-0">
          {t("chooseAndAdd")}
        </a>
      </div>
    </div>
  );
}
