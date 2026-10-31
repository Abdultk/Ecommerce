"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/use-auth";

const NAV = [
  { href: "/account/orders", key: "orders" },
  { href: "/account/addresses", key: "addresses" },
  { href: "/account/wishlist", key: "wishlist" },
  { href: "/account/settings", key: "settings" },
] as const;

/**
 * Client-side guard: the access token lives in memory, so only the browser knows whether
 * the shopper is signed in. The API still enforces auth on every /me and /orders call.
 */
export function AccountGuard({ children }: { children: ReactNode }) {
  const t = useTranslations("Account");
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [ready, user, router, pathname]);

  if (!user) {
    return (
      <p role="status" aria-live="polite" className="py-16 text-center text-smoke">
        {ready ? t("toSignIn") : t("checking")}
      </p>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-[220px_1fr]">
      <nav aria-label={t("account")} className="md:pt-2">
        <p className="stamp mb-3">{t("greeting", { name: user.firstName })}</p>
        <ul className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible">
          {NAV.map((item) => {
            const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 font-semibold ${current ? "bg-iron text-crust" : "hover:bg-parchment"}`}
                >
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
