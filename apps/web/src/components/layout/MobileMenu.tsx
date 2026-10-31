"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Category } from "@hp/contracts";
import { CloseIcon } from "@/components/ui/Icons";

/**
 * Slide-in menu for phones and tablets. A native <dialog> gives focus trapping, Esc to close
 * and a backdrop; the list is only rendered while open, and the menu closes on navigation.
 */
export function MobileMenu({ categories }: { categories: readonly Category[] }) {
  const t = useTranslations("Menu");
  const nav = useTranslations("Nav");
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  // Close after any navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const link =
    "flex min-h-12 items-center rounded-md px-3 text-lg font-medium transition-colors hover:bg-parchment";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid size-11 place-items-center rounded-md text-iron transition-colors hover:bg-parchment xl:hidden"
      >
        <span className="sr-only">{t("open")}</span>
        <span aria-hidden="true" className="grid gap-[5px]">
          <span className="block h-0.5 w-6 bg-current" />
          <span className="block h-0.5 w-4 bg-current" />
          <span className="block h-0.5 w-6 bg-current" />
        </span>
      </button>
      <dialog
        ref={ref}
        aria-label={t("label")}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === ref.current) setOpen(false);
        }}
        className="h-dvh max-h-none w-[min(92vw,24rem)] max-w-none bg-flour p-0 text-iron backdrop:bg-iron/50 open:animate-[slide-in_320ms_var(--ease-sear)]"
        style={{ margin: 0, insetBlockStart: 0, insetInlineStart: 0 }}
      >
        {open ? (
          <div className="flex h-full flex-col overflow-y-auto px-4 pb-8 pt-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-2xl">PAISLEY art</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-11 place-items-center rounded-md hover:bg-parchment"
              >
                <span className="sr-only">{t("close")}</span>
                <CloseIcon aria-hidden="true" />
              </button>
            </div>
            <nav aria-label={t("label")}>
              <ul className="space-y-1">
                <li>
                  <Link href="/shop" className={link}>
                    {nav("shopAll")}
                  </Link>
                </li>
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link href={`/c/${category.slug}`} className={link}>
                      {category.name}
                    </Link>
                    {category.children.length > 0 ? (
                      <ul className="mb-2 ms-3 space-y-0.5 border-s-2 border-sage-soft ps-3">
                        {category.children.map((child) => (
                          <li key={child.id}>
                            <Link
                              href={`/c/${child.slug}`}
                              className="flex min-h-11 items-center rounded-md px-2 text-base text-smoke transition-colors hover:bg-parchment hover:text-iron"
                            >
                              {child.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
