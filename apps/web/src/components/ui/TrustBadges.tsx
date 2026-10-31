"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "@hp/contracts";
import { useStoreConfig } from "@/components/providers/StoreConfig";

type Props = {
  /** "inline" (horizontal) for wide containers; "stacked" (vertical) for narrow ones. */
  variant?: "inline" | "stacked";
};

function LockIcon() {
  return (
    <svg className="size-4 shrink-0 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg className="size-4 shrink-0 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg className="size-4 shrink-0 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

/**
 * Trust badges strip: secure checkout, free shipping threshold, and returns.
 * Renders horizontally (inline) or vertically (stacked) depending on the container.
 */
export function TrustBadges({ variant = "inline" }: Props) {
  const t = useTranslations("Product.trust");
  const header = useTranslations("Header");
  const { currency, freeShippingThresholdCents } = useStoreConfig();

  const shippingLabel =
    freeShippingThresholdCents !== null && freeShippingThresholdCents > 0
      ? header("freeShippingOver", { amount: formatMoney(freeShippingThresholdCents, currency) })
      : t("freeDelivery");

  const badges = [
    { icon: <LockIcon />, label: t("secureCheckout") },
    { icon: <TruckIcon />, label: shippingLabel },
    { icon: <ReturnIcon />, label: t("easyReturns") },
  ];

  return (
    <ul
      className={`${
        variant === "inline"
          ? "flex flex-wrap items-center gap-x-6 gap-y-2"
          : "flex flex-col gap-2"
      }`}
    >
      {badges.map((badge) => (
        <li key={badge.label} className="stamp flex items-center gap-2 text-[0.8125rem]">
          {badge.icon}
          <span>{badge.label}</span>
        </li>
      ))}
    </ul>
  );
}
