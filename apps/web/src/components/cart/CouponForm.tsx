"use client";

import { useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ApplyCouponInput } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { TextField } from "@/components/auth/TextField";
import { useApplyCoupon, useRemoveCoupon } from "@/lib/cart";

/** The server's own shopper-facing message when there is one, otherwise the translated fallback. */
const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiClientError ? err.message : fallback;

/**
 * Discount code entry for the cart summary. The server validates and prices every code
 * (COUPON_INVALID comes back with a shopper-facing message); the client only checks format.
 */
export function CouponForm({ couponCode }: { couponCode: string | null }) {
  const t = useTranslations("Cart.coupon");
  const apply = useApplyCoupon();
  const remove = useRemoveCoupon();
  const input = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = new FormData(event.currentTarget).get("code");
    const parsed = ApplyCouponInput.safeParse({ code: typeof raw === "string" ? raw : "" });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.code?.[0]);
      input.current?.focus();
      return;
    }
    setFieldError(undefined);
    try {
      const cart = await apply.mutateAsync(parsed.data);
      setAnnouncement(t("announceApplied", { code: cart.couponCode ?? parsed.data.code }));
    } catch (err) {
      setFieldError(messageOf(err, t("applyFallback")));
      input.current?.focus();
    }
  }

  async function handleRemove() {
    setRemoveError(null);
    try {
      await remove.mutateAsync();
      setAnnouncement(t("announceRemoved"));
    } catch (err) {
      setRemoveError(messageOf(err, t("removeFallback")));
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      {couponCode ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>
            {t.rich("applied", {
              code: couponCode,
              // Codes are Latin letters and digits; <bdi> keeps RTL text from reordering them.
              mono: (chunks) => (
                <strong className="font-mono [unicode-bidi:isolate]">{chunks}</strong>
              ),
            })}
          </p>
          <button
            type="button"
            className="link-underline inline-flex min-h-6 items-center font-semibold"
            onClick={() => void handleRemove()}
            disabled={remove.isPending}
            aria-label={t("removeCode", { code: couponCode })}
          >
            {remove.isPending ? t("removing") : t("remove")}
          </button>
          {removeError ? (
            <p role="alert" className="w-full font-medium text-danger">
              {removeError}
            </p>
          ) : null}
        </div>
      ) : (
        <form noValidate onSubmit={(e) => void handleApply(e)} className="grid gap-2">
          <TextField
            ref={input}
            name="code"
            label={t("label")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            error={fieldError}
          />
          <button type="submit" className="btn btn-iron" disabled={apply.isPending}>
            {apply.isPending ? t("applying") : t("apply")}
          </button>
        </form>
      )}
      <p role="status" aria-live="polite" className="mt-2 text-sm text-sage">
        {announcement}
      </p>
    </div>
  );
}
