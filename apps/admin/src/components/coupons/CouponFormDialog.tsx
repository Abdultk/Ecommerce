"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { CouponType, CouponView, type CurrencyCode } from "@hp/contracts";
import { Modal } from "@/components/ui/Modal";
import { FieldError } from "@/components/ui/NoAccess";
import { moneyLabel } from "@/lib/money";
import { errorMessage, useSession } from "@/lib/session";
import { useStoreCurrency } from "@/lib/store-settings";
import {
  couponFormFrom,
  emptyCoupon,
  validateCoupon,
  type CouponFormValues,
  type CouponKind,
} from "./coupon-form-model";

const TYPE_LABELS: Record<CouponKind, string> = {
  PERCENT: "Percent off",
  FIXED: "Fixed amount off",
  FREE_SHIPPING: "Free shipping",
};

type CouponFormDialogProps = {
  /** Omit to create. */
  coupon?: CouponView;
  onSaved: (coupon: CouponView) => void;
  onClose: () => void;
};

/** Waits for the store currency so amounts are never parsed with the wrong decimals. */
export function CouponFormDialog(props: CouponFormDialogProps) {
  const { currency, isReady } = useStoreCurrency();
  if (!isReady) {
    return (
      <Modal
        title={props.coupon ? `Edit ${props.coupon.code}` : "New coupon"}
        onClose={props.onClose}
      >
        <p role="status" className="text-sm text-muted">
          Loading the store currency…
        </p>
      </Modal>
    );
  }
  return <CouponForm {...props} currency={currency} />;
}

function CouponForm({
  coupon,
  onSaved,
  onClose,
  currency,
}: CouponFormDialogProps & { currency: CurrencyCode }) {
  const { api } = useSession();
  const ids = useId();
  const [form, setForm] = useState<CouponFormValues>(() =>
    coupon ? couponFormFrom(coupon, currency) : emptyCoupon(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { body, errors: found } = validateCoupon(form, currency);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const { data } = coupon
        ? await api.patch(`/admin/coupons/${coupon.id}`, body, CouponView)
        : await api.post("/admin/coupons", body, CouponView);
      onSaved(data);
    } catch (err) {
      setFormError(errorMessage(err));
      setBusy(false);
    }
  }

  const field = (
    key: keyof CouponFormValues,
    errorKey: string,
    label: string,
    input: { type?: string; inputMode?: "decimal" | "numeric"; hint?: ReactNode; mono?: boolean },
  ) => {
    const id = `${ids}-${key}`;
    const error = errors[errorKey];
    const describedBy = [error && `${id}-error`, input.hint && `${id}-hint`]
      .filter(Boolean)
      .join(" ");
    return (
      <div>
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <input
          id={id}
          type={input.type ?? "text"}
          inputMode={input.inputMode}
          value={form[key] as string}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => set(key, e.target.value as never)}
          className={`field field-compact${input.mono ? " font-mono uppercase" : ""}`}
        />
        {input.hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
            {input.hint}
          </p>
        )}
        <FieldError id={`${id}-error`} message={error} />
      </div>
    );
  };

  return (
    <Modal title={coupon ? `Edit ${coupon.code}` : "New coupon"} onClose={onClose} size="lg">
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("code", "code", "Code", {
            mono: true,
            hint:
              coupon && coupon.redemptions > 0
                ? "This code has been used, so it can't be renamed."
                : "3–32 letters, numbers or hyphens.",
          })}
          <div>
            <label htmlFor={`${ids}-type`} className="field-label">
              Type
            </label>
            <select
              id={`${ids}-type`}
              value={form.type}
              onChange={(e) => set("type", e.target.value as CouponKind)}
              className="field field-compact"
            >
              {CouponType.options.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          {form.type === "PERCENT" &&
            field("value", "value", "Percent off (%)", { inputMode: "numeric" })}
          {form.type === "FIXED" &&
            field("value", "value", moneyLabel("Amount off", currency), { inputMode: "decimal" })}
          {form.type === "FREE_SHIPPING" && (
            <p className="self-end text-sm text-muted">
              Free shipping has no discount value: shipping is set to zero.
            </p>
          )}
          {field("minSubtotal", "minSubtotalCents", moneyLabel("Minimum subtotal", currency), {
            inputMode: "decimal",
            hint: "Blank for no minimum.",
          })}
          {field("maxRedemptions", "maxRedemptions", "Total uses", {
            inputMode: "numeric",
            hint: "Blank for unlimited.",
          })}
          {field("perCustomerLimit", "perCustomerLimit", "Uses per customer", {
            inputMode: "numeric",
            hint: "Blank for unlimited.",
          })}
          {field("startsAt", "startsAt", "Starts", { type: "date", hint: "Optional." })}
          {field("endsAt", "endsAt", "Ends", { type: "date", hint: "Optional." })}
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={form.isActive}
            onChange={(e) => set("isActive", e.target.checked)}
          />
          Active
        </label>
        {formError && (
          <p role="alert" className="error-text">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {coupon ? "Save coupon" : "Create coupon"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
