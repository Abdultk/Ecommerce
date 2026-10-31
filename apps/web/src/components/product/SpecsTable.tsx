import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ProductDetail } from "@hp/contracts";
import { CheckIcon, CloseIcon, CoilIcon, DropIcon, FlameIcon } from "@/components/ui/Icons";

type Props = {
  product: Pick<
    ProductDetail,
    "material" | "ovenSafeToF" | "inductionCompatible" | "dishwasherSafe" | "careInstructions"
  >;
};

function yesNo(value: boolean | null, yes: string, no: string, notListed: string): ReactNode {
  if (value === null) return <span className="text-smoke">{notListed}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold ${value ? "text-sage" : "text-danger"}`}
    >
      {value ? <CheckIcon /> : <CloseIcon />}
      {value ? yes : no}
    </span>
  );
}

const toCelsius = (f: number) => Math.round(((f - 32) * 5) / 9);

/** The kitchen spec card: what a cook checks before buying. */
export function SpecsTable({ product }: Props) {
  const t = useTranslations("Product.specs");
  const notListed = t("notListed");
  const rows: { icon: ReactNode; label: string; value: ReactNode }[] = [
    {
      icon: <span className="font-mono text-xs">Fe</span>,
      label: t("material"),
      value: product.material ?? notListed,
    },
    {
      icon: <FlameIcon />,
      label: t("ovenSafe"),
      value:
        product.ovenSafeToF === null ? (
          <span className="text-smoke">{t("ovenNone")}</span>
        ) : (
          <span>
            {t("ovenUpTo", { f: product.ovenSafeToF, c: toCelsius(product.ovenSafeToF) })}
          </span>
        ),
    },
    {
      icon: <CoilIcon />,
      label: t("induction"),
      value: yesNo(product.inductionCompatible, t("inductionYes"), t("inductionNo"), notListed),
    },
    {
      icon: <DropIcon />,
      label: t("dishwasher"),
      value: yesNo(product.dishwasherSafe, t("dishwasherYes"), t("dishwasherNo"), notListed),
    },
    {
      icon: <span aria-hidden="true">✦</span>,
      label: t("care"),
      value: product.careInstructions ?? notListed,
    },
  ];

  return (
    <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-[var(--radius-tile)] bg-crust text-sm">
      <caption className="stamp mb-3 text-start">{t("caption")}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="[&:not(:last-child)>*]:border-b [&>*]:border-line">
            <th scope="row" className="w-[38%] px-4 py-3 text-start align-top font-semibold">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="grid size-6 place-items-center text-ember-deep">
                  {row.icon}
                </span>
                {row.label}
              </span>
            </th>
            <td className="px-4 py-3 align-top">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
