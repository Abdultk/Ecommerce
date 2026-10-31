"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Props = {
  href: string;
  /** Also active for every path beneath it (a category covers its sub-categories). */
  prefix?: boolean;
  /** Extra match for a parent whose children live at other URLs. */
  alsoActive?: readonly string[];
  className?: string;
  children: ReactNode;
};

/** A link that marks the page the visitor is on with aria-current and a stronger underline. */
export function NavLink({ href, prefix = true, alsoActive = [], className = "", children }: Props) {
  const pathname = usePathname() ?? "";
  const active =
    pathname === href ||
    (prefix && href !== "/" && pathname.startsWith(`${href}/`)) ||
    alsoActive.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${className} ${active ? "text-forest underline decoration-copper decoration-2 underline-offset-[10px]" : ""}`}
    >
      {children}
    </Link>
  );
}
