import { z } from "zod";

export const ROLES = ["CUSTOMER", "STAFF", "ADMIN", "SUPER_ADMIN"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const ALL_PERMISSIONS = [
  "product:read",
  "product:write",
  "product:delete",
  "inventory:read",
  "inventory:write",
  "order:read",
  "order:write",
  "order:refund",
  "coupon:write",
  "user:read",
  "user:write",
  "analytics:read",
  "analytics:export",
  "audit:read",
  // Phase 3b
  "settings:read",
  "settings:write",
  "user:reset-password",
  "order:confirm-payment",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

const STAFF_PERMISSIONS: readonly Permission[] = [
  "product:read",
  "product:write",
  "inventory:read",
  "inventory:write",
  "order:read",
  "order:write",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...STAFF_PERMISSIONS,
  "product:delete",
  "order:refund",
  "coupon:write",
  "user:read",
  "analytics:read",
  "analytics:export",
  "settings:read",
  "user:reset-password",
  "order:confirm-payment",
];
// settings:write (currency, bank details) stays with SUPER_ADMIN, who holds every permission.

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = Object.freeze({
  CUSTOMER: new Set<Permission>(),
  STAFF: new Set(STAFF_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  SUPER_ADMIN: new Set(ALL_PERMISSIONS),
});

/**
 * The single permission check used by the API (enforcement) and the admin UI (hiding controls).
 * Unknown roles are denied rather than throwing.
 */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** A fresh array of the role's permissions; mutating it has no effect on `can`. */
export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function isAdminRole(role: Role): boolean {
  return role !== "CUSTOMER" && ROLES.includes(role);
}
