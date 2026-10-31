"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { CloseIcon } from "@/components/ui/Icons";
import { CartContents } from "./CartContents";
import { useCartDrawer } from "./CartDrawerContext";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal side sheet: traps focus, closes on Escape or backdrop, returns focus to the trigger. */
export function CartDrawer() {
  const t = useTranslations("Cart");
  const { isOpen, close } = useCartDrawer();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      returnFocusRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-iron/45 backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        className="animate-rise absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-flour shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="cart-drawer-title" className="text-2xl">
            {t("drawerTitle")}
          </h2>
          <button
            type="button"
            onClick={close}
            data-autofocus
            aria-label={t("closeCart")}
            className="grid size-11 place-items-center rounded-full hover:bg-parchment"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-2">
          <CartContents variant="drawer" onNavigate={close} />
        </div>
      </div>
    </div>
  );
}
