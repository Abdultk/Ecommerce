"use client";

import { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";

type Props = {
  freeShippingText?: string | null;
};

export function AnnouncementBar({ freeShippingText }: Props) {
  const t = useTranslations("Header");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const announcements = [
    freeShippingText,
    t("deliveryDays"),
    t("welcomeCoupon"),
  ].filter((item): item is string => Boolean(item));

  const total = announcements.length;

  useEffect(() => {
    if (isPaused || total <= 1) return;

    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % total);
    }, 4500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, total]);

  if (total === 0) return null;

  const next = () => setCurrentIndex((prev) => (prev + 1) % total);
  const prev = () => setCurrentIndex((prev) => (prev - 1 + total) % total);

  return (
    <div
      role="region"
      aria-label="Announcements"
      className="relative flex items-center justify-center overflow-hidden bg-forest px-8 py-2 text-center text-[0.8125rem] font-medium tracking-wide text-flour transition-[max-height,padding] duration-300 ease-[var(--ease-sear)] group-data-[scrolled=true]/header:max-h-0 group-data-[scrolled=true]/header:py-0"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      {/* All messages share one grid cell, so the bar is as tall as the longest one and a long message wraps instead of being clipped on a phone. */}
      <div className="grid min-h-5 items-center justify-items-center">
        {announcements.map((item, idx) => (
          <div
            key={idx}
            aria-hidden={idx !== currentIndex}
            className={`col-start-1 row-start-1 transition-all duration-500 ease-[var(--ease-sear)] ${
              idx === currentIndex
                ? "translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-2 opacity-0"
            }`}
          >
            <span>{item}</span>
          </div>
        ))}
      </div>

      {total > 1 && (
        <div className="absolute inset-y-0 end-3 hidden items-center gap-1 sm:flex">
          <button
            type="button"
            onClick={prev}
            aria-label={t("previousAnnouncement")}
            className="flex size-5 items-center justify-center rounded text-flour/70 transition-colors hover:text-flour"
          >
            <svg className="size-3 flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={next}
            aria-label={t("nextAnnouncement")}
            className="flex size-5 items-center justify-center rounded text-flour/70 transition-colors hover:text-flour"
          >
            <svg className="size-3 flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
