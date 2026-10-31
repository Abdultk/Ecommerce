import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="mx-auto max-w-2xl px-4 py-20">
      <div className="tile-bg space-y-5 rounded-sm p-10 text-center">
        <p className="stamp justify-center">{t("stamp")}</p>
        <h1 className="text-[length:var(--text-display)]">{t("title")}</h1>
        <p className="text-smoke">{t("body")}</p>
        <Link href="/shop" className="btn btn-iron">
          {t("browse")}
        </Link>
      </div>
    </div>
  );
}
