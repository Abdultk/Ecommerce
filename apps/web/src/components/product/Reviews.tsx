"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Review } from "@hp/contracts";
import { intlLocale, type Locale } from "@/i18n/config";
import { formatDateIn } from "@/lib/format";
import { errorMessage } from "@/lib/orders";
import { useReviews } from "@/lib/reviews";
import { ReviewForm } from "./ReviewForm";

function Stars({ rating }: { rating: number }) {
  const t = useTranslations("Product.reviews");
  return (
    <span
      role="img"
      aria-label={t("rated", { rating })}
      className="tracking-[0.12em] text-ember"
    >
      <span aria-hidden="true">
        {"★".repeat(rating)}
        <span className="text-line">{"★".repeat(5 - rating)}</span>
      </span>
    </span>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const t = useTranslations("Product.reviews");
  const locale = useLocale() as Locale;
  return (
    <article className="space-y-1.5 py-5">
      <Stars rating={review.rating} />
      <h3 className="text-lg font-semibold">{review.title}</h3>
      <p className="text-smoke">{review.body}</p>
      <p className="text-xs text-smoke">
        {review.authorName}
        {review.verifiedPurchase ? ` · ${t("verified")}` : ""} ·{" "}
        <time dateTime={review.createdAt}>
          {formatDateIn(review.createdAt, intlLocale(locale))}
        </time>
      </p>
    </article>
  );
}

/** Paged reviews plus a "Write a review" form. */
export function Reviews({ slug }: { slug: string }) {
  const t = useTranslations("Product.reviews");
  const [page, setPage] = useState(1);
  const [writing, setWriting] = useState(false);
  const [posted, setPosted] = useState(false);
  const { data, isPending, isError, error } = useReviews(slug, page);
  const totalPages = data?.meta?.totalPages ?? 1;

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24 space-y-5 border-t border-line pt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reviews-heading" className="text-3xl">
          {t("heading")}
        </h2>
        {writing || posted ? null : (
          <button type="button" className="btn btn-ghost" onClick={() => setWriting(true)}>
            {t("write")}
          </button>
        )}
      </div>

      <p role="status" className={posted ? "font-semibold text-sage" : "sr-only"}>
        {posted ? t("thanks") : ""}
      </p>

      {writing ? (
        <ReviewForm
          slug={slug}
          onPosted={() => {
            setWriting(false);
            setPosted(true);
            setPage(1);
          }}
        />
      ) : null}

      {isPending ? <div aria-busy="true" className="skeleton h-40" /> : null}
      {isError ? (
        <p role="alert" className="font-semibold text-danger">
          {errorMessage(error)}
        </p>
      ) : null}
      {data && data.data.length === 0 ? (
        <p className="text-smoke">{t("none")}</p>
      ) : null}
      {data && data.data.length > 0 ? (
        <ul aria-label={t("list")} className="divide-y divide-line">
          {data.data.map((review) => (
            <li key={review.id}>
              <ReviewCard review={review} />
            </li>
          ))}
        </ul>
      ) : null}

      {totalPages > 1 ? (
        <nav aria-label={t("pages")} className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("previous")}
          </button>
          <p aria-live="polite" className="text-sm text-smoke">
            {t("page", { page, total: totalPages })}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </button>
        </nav>
      ) : null}
    </section>
  );
}
