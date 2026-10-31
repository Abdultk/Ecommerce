"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ReviewInput } from "@hp/contracts";
import { TextField } from "@/components/auth/TextField";
import { reviewErrorFor, useSubmitReview } from "@/lib/reviews";

type Field = "rating" | "title" | "body";
type Errors = Partial<Record<Field, string>>;

const RATINGS = [1, 2, 3, 4, 5] as const;
type Translate = ReturnType<typeof useTranslations<"Product.reviews">>;

function validate(form: HTMLFormElement, t: Translate) {
  const data = new FormData(form);
  const parsed = ReviewInput.safeParse({
    rating: Number(data.get("rating") ?? 0),
    title: String(data.get("title") ?? ""),
    body: String(data.get("body") ?? ""),
  });
  if (parsed.success) return { success: true as const, data: parsed.data };
  const fields = parsed.error.flatten().fieldErrors;
  const errors: Errors = {
    rating: fields.rating ? t("ratingError") : undefined,
    title: fields.title ? t("titleError") : undefined,
    body: fields.body?.[0],
  };
  return { success: false as const, errors };
}

/** Rating as a native radio group (arrow keys), title and body, with the API's 401/403/409. */
export function ReviewForm({ slug, onPosted }: { slug: string; onPosted: () => void }) {
  const t = useTranslations("Product.reviews");
  const submit = useSubmitReview(slug);
  const [errors, setErrors] = useState<Errors>({});
  const ids = { legend: useId(), rating: useId(), body: useId(), bodyError: useId() };
  const firstRadio = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(event.currentTarget, t);
    if (!result.success) {
      setErrors(result.errors);
      const first = result.errors.rating ? firstRadio : result.errors.title ? title : body;
      first.current?.focus();
      return;
    }
    setErrors({});
    submit.mutate(result.data, { onSuccess: onPosted });
  }

  const failure = submit.isError ? reviewErrorFor(submit.error) : null;
  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-5 rounded-[var(--radius-pan)] bg-crust p-5 shadow-[var(--shadow-plate)]"
    >
      {failure ? (
        <p
          role="alert"
          className="rounded-[var(--radius-tile)] bg-danger-wash px-4 py-3 text-sm font-semibold text-danger"
        >
          {failure.message}{" "}
          {failure.kind === "signin" ? (
            <Link
              href={`/login?next=${encodeURIComponent(`/p/${slug}`)}`}
              className="link-underline"
            >
              {t("signIn")}
            </Link>
          ) : null}
        </p>
      ) : null}
      <fieldset
        role="radiogroup"
        aria-labelledby={ids.legend}
        aria-describedby={errors.rating ? ids.rating : undefined}
        aria-invalid={errors.rating ? true : undefined}
      >
        <legend id={ids.legend} className="mb-2 text-sm font-semibold">
          {t("yourRating")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {RATINGS.map((value) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-line px-3 has-[:checked]:border-ember has-[:checked]:bg-ember-wash"
            >
              <input
                ref={value === 1 ? firstRadio : undefined}
                type="radio"
                name="rating"
                value={value}
                className="size-4 accent-ember"
              />
              <span aria-hidden="true" className="text-ember">
                {"★".repeat(value)}
              </span>
              <span className="sr-only">{t("stars", { count: value, n: value })}</span>
            </label>
          ))}
        </div>
        {errors.rating ? (
          <p id={ids.rating} className="mt-1.5 text-sm font-medium text-danger">
            {errors.rating}
          </p>
        ) : null}
      </fieldset>
      <TextField
        ref={title}
        name="title"
        label={t("title")}
        maxLength={120}
        error={errors.title}
        required
      />
      <div className="space-y-1.5">
        <label htmlFor={ids.body} className="block text-sm font-semibold">
          {t("review")}
        </label>
        <textarea
          ref={body}
          id={ids.body}
          name="body"
          rows={5}
          maxLength={4000}
          className="field"
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errors.body ? ids.bodyError : undefined}
          required
        />
        {errors.body ? (
          <p id={ids.bodyError} className="text-sm font-medium text-danger">
            {errors.body}
          </p>
        ) : null}
      </div>
      <button type="submit" className="btn btn-primary" disabled={submit.isPending}>
        {submit.isPending ? t("posting") : t("post")}
      </button>
    </form>
  );
}
