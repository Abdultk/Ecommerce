import { can, isAdminRole, type Permission, type Role } from "@hp/contracts";

export type NavSection = {
  id: string;
  label: string;
  href: string;
  /** null = every admin role (Overview). */
  permission: Permission | null;
  /** Short glyph shown in the sidebar; decorative only. */
  glyph: string;
};

export const NAV_SECTIONS: readonly NavSection[] = [
  { id: "overview", label: "Overview", href: "/", permission: null, glyph: "◰" },
  {
    id: "products",
    label: "Products",
    href: "/products",
    permission: "product:read",
    glyph: "▤",
  },
  {
    id: "categories",
    label: "Categories",
    href: "/categories",
    permission: "product:read",
    glyph: "⌗",
  },
  {
    id: "orders",
    label: "Orders",
    href: "/orders",
    permission: "order:read",
    glyph: "≡",
  },
  {
    id: "customers",
    label: "Customers",
    href: "/customers",
    permission: "user:read",
    glyph: "◎",
  },
  {
    id: "inventory",
    label: "Inventory",
    href: "/inventory",
    permission: "inventory:read",
    glyph: "▦",
  },
  {
    id: "coupons",
    label: "Coupons",
    href: "/coupons",
    permission: "coupon:write",
    glyph: "%",
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/analytics",
    permission: "analytics:read",
    glyph: "◿",
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    permission: "analytics:export",
    glyph: "⇩",
  },
  {
    id: "staff",
    label: "Staff",
    href: "/staff",
    permission: "user:write",
    glyph: "◇",
  },
  {
    id: "audit-log",
    label: "Audit log",
    href: "/audit-log",
    permission: "audit:read",
    glyph: "✎",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    permission: "settings:read",
    glyph: "⚙",
  },
];

export function canAccess(role: Role, section: NavSection): boolean {
  if (!isAdminRole(role)) return false;
  return section.permission === null || can(role, section.permission);
}

/** The sections a role may open, in sidebar order. */
export function navFor(role: Role): NavSection[] {
  return NAV_SECTIONS.filter((s) => canAccess(role, s));
}

export function sectionById(id: string): NavSection {
  const section = NAV_SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown admin section: ${id}`);
  return section;
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
