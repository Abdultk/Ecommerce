import Link from "next/link";
import { useTranslations } from "next-intl";
import { MAX_LINE_QUANTITY, formatMoney, type CartLine, type CurrencyCode } from "@hp/contracts";
import { ProductImage } from "@/components/catalog/ProductImage";
import { MinusIcon, PlusIcon } from "@/components/ui/Icons";

type Props = {
  line: CartLine;
  currency: CurrencyCode;
  onNavigate?: () => void;
  onQuantity?: (quantity: number) => void;
  onRemove?: () => void;
  error?: string;
  busy?: boolean;
};

const stepButton =
  "grid size-11 place-items-center rounded-full disabled:text-line hover:bg-parchment disabled:hover:bg-transparent";

export function CartLineItem({
  line,
  currency,
  onNavigate,
  onQuantity,
  onRemove,
  error,
  busy,
}: Props) {
  const t = useTranslations("Cart");
  const lowStock = line.stockAvailable > 0 && line.stockAvailable <= 5;
  const max = Math.min(MAX_LINE_QUANTITY, Math.max(1, line.stockAvailable));
  const name = line.productName;
  return (
    <li aria-label={`${name}, ${line.variantName}`} className="flex gap-4 py-4">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-tile)] bg-parchment">
        <ProductImage src={line.thumbnailUrl} alt="" sizes="80px" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/p/${line.productSlug}`}
          onClick={onNavigate}
          className="font-semibold leading-snug hover:text-ember-deep"
        >
          {name}
        </Link>
        <p className="text-sm text-smoke">
          {line.variantName} · {t("each", { price: formatMoney(line.unitPriceCents, currency) })}
        </p>
        {lowStock ? (
          <p className="text-xs font-semibold text-ember-deep">
            {t("onlyLeft", { count: line.stockAvailable })}
          </p>
        ) : null}
        {onQuantity && onRemove ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t("quantityOf", { name })}
              aria-busy={busy || undefined}
              className="flex items-center rounded-full border-2 border-stroke bg-crust"
            >
              <button
                type="button"
                className={stepButton}
                aria-label={t("decrease", { name })}
                disabled={line.quantity <= 1}
                onClick={() => onQuantity(line.quantity - 1)}
              >
                <MinusIcon />
              </button>
              <output aria-live="polite" className="w-8 text-center font-semibold">
                {line.quantity}
              </output>
              <button
                type="button"
                className={stepButton}
                aria-label={t("increase", { name })}
                disabled={line.quantity >= max}
                onClick={() => onQuantity(line.quantity + 1)}
              >
                <PlusIcon />
              </button>
            </div>
            <button
              type="button"
              className="min-h-11 rounded-full px-3 text-sm font-semibold text-smoke underline underline-offset-4 hover:text-danger"
              aria-label={t("removeFromCart", { name })}
              onClick={onRemove}
            >
              {t("remove")}
            </button>
          </div>
        ) : (
          <p className="text-sm text-smoke">{t("qty", { count: line.quantity })}</p>
        )}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <p className="font-semibold">{formatMoney(line.lineTotalCents, currency)}</p>
    </li>
  );
}
