import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";

/** The brand artwork as supplied (paisley mark, PAISLEY, art), re-laid on one line for the
 * header. The name is part of the image, so it is not retyped beside it. */
export function Logo() {
  const t = useTranslations("Header");
  return (
    <Link href="/" className="inline-flex items-center" aria-label={t("logoAria")}>
      <Image
        src="/logo-inline.png"
        alt="PAISLEY art"
        width={873}
        height={239}
        className="h-8 w-auto min-[380px]:h-9 min-[430px]:h-11 sm:h-14 lg:h-16"
        priority
      />
    </Link>
  );
}
