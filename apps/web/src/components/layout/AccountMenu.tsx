"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UserIcon } from "@/components/ui/Icons";
import { signOut } from "@/lib/auth-store";
import { useAuth } from "@/lib/use-auth";

export function AccountMenu() {
  const t = useTranslations("Account");
  const { user, ready } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) {
    return (
      <Link
        href="/login"
        aria-busy={!ready}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-md px-2.5 sm:px-3 text-sm font-semibold hover:bg-parchment"
      >
        <UserIcon />
        <span className="hidden sm:inline">{t("signIn")}</span>
        <span className="sr-only sm:hidden">{t("signIn")}</span>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="hidden font-semibold md:inline">{t("greeting", { name: user.firstName })}</span>
      <Link
        href="/account/orders"
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-md px-2.5 sm:px-3 font-semibold hover:bg-parchment"
      >
        <UserIcon />
        <span className="hidden sm:inline">{t("account")}</span>
        <span className="sr-only sm:hidden">{t("account")}</span>
      </Link>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          // The in-memory session is cleared even if the server call fails.
          signOut()
            .catch((err: unknown) => console.warn("[auth] server sign-out failed", err))
            .finally(() => setSigningOut(false));
        }}
        className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 font-semibold hover:bg-parchment"
      >
        {signingOut ? t("signingOut") : t("signOut")}
      </button>
    </div>
  );
}
