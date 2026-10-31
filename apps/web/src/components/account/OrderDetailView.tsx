"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { OrderDetailBody } from "@/components/orders/OrderDetailBody";
import { cancellable, errorMessage, useCancelOrder, useOrder } from "@/lib/orders";

export function OrderDetailView({ number }: { number: string }) {
  const t = useTranslations("Account.orders");
  const { data: order, isPending, isError, error } = useOrder(number);
  const cancel = useCancelOrder(number);

  if (isPending) return <div aria-busy="true" className="skeleton h-96" />;
  if (isError) {
    return (
      <div className="space-y-4">
        <p role="alert" className="font-semibold text-danger">
          {errorMessage(error)}
        </p>
        <Link href="/account/orders" className="btn btn-ghost">
          {t("backToOrders")}
        </Link>
      </div>
    );
  }
  return (
    <OrderDetailBody
      order={order}
      actions={
        <>
          {cancel.isSuccess ? (
            <p
              role="status"
              className="rounded-[var(--radius-tile)] bg-sage-wash p-4 font-semibold"
            >
              {t("cancelledNote")}
            </p>
          ) : null}
          {cancellable(order.status) ? <CancelOrder number={order.number} cancel={cancel} /> : null}
        </>
      }
    />
  );
}

/** Cancel with typed confirmation: the button only arms once the order number is typed. */
type CancelProps = { number: string; cancel: ReturnType<typeof useCancelOrder> };

function CancelOrder({ number, cancel }: CancelProps) {
  const t = useTranslations("Account.orders");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) input.current?.focus();
    else if (wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    return (
      <button ref={trigger} type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        {t("cancel")}
      </button>
    );
  }

  const armed = typed.trim() === number;
  return (
    <form
      className="space-y-3 rounded-[var(--radius-tile)] border-2 border-danger bg-danger-wash p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (armed) cancel.mutate();
      }}
    >
      <p className="text-sm">{t("cancelWarning")}</p>
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {t("typeToConfirm", { number })}
      </label>
      <input
        ref={input}
        id={inputId}
        className="field font-mono"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {cancel.isError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {errorMessage(cancel.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={!armed || cancel.isPending}>
          {cancel.isPending ? t("cancelling") : t("yesCancel")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          {t("keepOrder")}
        </button>
      </div>
    </form>
  );
}
