"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProductImage as ProductImageType } from "@hp/contracts";
import { ProductImage } from "@/components/catalog/ProductImage";
import { ArrowIcon, CloseIcon } from "@/components/ui/Icons";

type Props = {
  images: readonly ProductImageType[];
  productName: string;
};

export function Gallery({ images, productName }: Props) {
  const t = useTranslations("Product.gallery");
  const ordered = [...images].sort((a, b) => a.position - b.position);
  const [activeId, setActiveId] = useState(ordered[0]?.id ?? null);
  const [zoomed, setZoomed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const index = Math.max(
    0,
    ordered.findIndex((image) => image.id === activeId),
  );
  const active = ordered[index];

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (zoomed && !node.open) node.showModal?.();
    if (!zoomed && node.open) node.close?.();
  }, [zoomed]);

  const step = (delta: number) => {
    const next = ordered[(index + delta + ordered.length) % ordered.length];
    if (next) setActiveId(next.id);
  };

  return (
    <div className="space-y-4">
      <p className="hidden items-center justify-end gap-1.5 text-xs text-smoke sm:flex">
        <svg
          className="size-3 text-copper"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
        {t("clickToExpand")}
      </p>

      <div className="relative aspect-[4/5] w-full">
        <button
          type="button"
          id="gallery-main-image-zoom"
          onClick={() => setZoomed(true)}
          aria-label={t("zoom", { alt: active?.alt || productName })}
          className="group relative block size-full cursor-zoom-in overflow-hidden rounded-[var(--radius-pan)] bg-sage-wash shadow-plate transition-shadow duration-300 hover:shadow-lift"
        >
          <ProductImage
            src={active?.url ?? null}
            alt={active?.alt || productName}
            label={productName}
            sizes="(min-width: 1024px) 50vw, 100vw"
            priority
            className="transition-transform duration-700 ease-[var(--ease-sear)] group-hover:scale-[1.04]"
          />
        </button>
      </div>

      {ordered.length > 1 ? (
        <ul className="flex flex-wrap gap-2.5 pt-1" aria-label={t("images")}>
          {ordered.map((image, i) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setActiveId(image.id)}
                aria-pressed={image.id === active?.id}
                aria-label={t("showImage", { n: i + 1, total: ordered.length })}
                className={`relative size-20 overflow-hidden rounded-tile border-2 transition-all duration-200 ${
                  image.id === active?.id
                    ? "border-forest shadow-sm scale-105"
                    : "border-transparent opacity-80 hover:opacity-100 hover:border-line"
                }`}
              >
                <ProductImage src={image.url} alt="" label={productName} sizes="80px" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <dialog
        ref={dialog}
        aria-label={t("dialog", { name: productName })}
        onClose={() => setZoomed(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setZoomed(false);
        }}
        className="m-auto h-[min(92dvh,56rem)] w-[min(96vw,64rem)] max-w-none overflow-hidden rounded-[var(--radius-pan)] bg-flour p-0 backdrop:bg-iron/70"
      >
        {zoomed ? (
          <div className="relative h-full w-full">
            <ProductImage
              src={active?.url ?? null}
              alt={active?.alt || productName}
              label={productName}
              sizes="96vw"
            />
            <button
              type="button"
              onClick={() => setZoomed(false)}
              className="absolute end-3 top-3 grid size-11 place-items-center rounded-md bg-flour/90 hover:bg-flour"
            >
              <span className="sr-only">{t("closeZoom")}</span>
              <CloseIcon aria-hidden="true" />
            </button>
            {ordered.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  className="absolute start-3 top-1/2 grid size-11 -translate-y-1/2 rotate-180 place-items-center rounded-md bg-flour/90 hover:bg-flour"
                >
                  <span className="sr-only">{t("previous")}</span>
                  <ArrowIcon aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  className="absolute end-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-md bg-flour/90 hover:bg-flour"
                >
                  <span className="sr-only">{t("next")}</span>
                  <ArrowIcon aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
