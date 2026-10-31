import { useTranslations } from "next-intl";
import { formatRating } from "@/lib/format";

const count = new Intl.NumberFormat("en-US");

type Props = { average: number; reviews: number; size?: "sm" | "md" };

/** Five stars drawn with a clipped overlay; one accessible name for the whole thing. */
export function Rating({ average, reviews, size = "sm" }: Props) {
  const t = useTranslations("Product.rating");
  const text = size === "sm" ? "text-sm" : "text-base";
  // No reviews means no rating to show: never draw an empty "0.0".
  if (reviews === 0) return <span className={`text-smoke ${text}`}>{t("none")}</span>;
  const label = t("label", {
    average: formatRating(average),
    count: reviews,
    n: count.format(reviews),
  });
  const pct = `${Math.max(0, Math.min(5, average)) * 20}%`;

  return (
    <span className={`inline-flex items-center gap-2 ${text}`}>
      {/* dir="ltr" keeps the clip-fill going left→right regardless of page direction */}
      <span
        role="img"
        aria-label={label}
        dir="ltr"
        className="relative inline-block leading-none tracking-[0.12em]"
      >
        <span aria-hidden="true" className="text-line">
          ★★★★★
        </span>
        <span
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden text-ember"
          style={{ width: pct }}
        >
          ★★★★★
        </span>
      </span>
      <span aria-hidden="true" className="text-smoke">
        {formatRating(average)} <span className="text-xs">({count.format(reviews)})</span>
      </span>
    </span>
  );
}
