"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, navFor } from "@/lib/nav";
import { useSession } from "@/lib/session";

type SidebarProps = {
  /** Called after a link is chosen, so the mobile drawer can close. */
  onNavigate?: () => void;
};

export function Sidebar({ onNavigate }: SidebarProps) {
  const { user } = useSession();
  const pathname = usePathname();
  if (!user) return null;

  return (
    <nav aria-label="Admin sections" className="px-3 py-4">
      <ul className="space-y-0.5">
        {navFor(user.role).map((section) => {
          const active = isActivePath(pathname, section.href);
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                data-glyph={section.glyph}
                className={[
                  "nav-link group relative flex items-center gap-3 rounded-md py-2 pr-3 pl-4 text-[0.875rem] font-medium",
                  "before:w-4 before:text-center before:font-mono before:text-[0.8rem] before:content-[attr(data-glyph)]",
                  active
                    ? "bg-ink-800 text-white before:text-ember-400"
                    : "text-ink-200 before:text-ink-400 hover:bg-ink-900 hover:text-white",
                ].join(" ")}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-ember-500"
                  />
                )}
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
