import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  ROLES,
  can,
  isAdminRole,
  permissionsFor,
  type Permission,
  type Role,
} from "../src/rbac";

// Written out independently of the implementation so any drift from the
// blueprint's role → permission matrix (Section 3.5) fails this test.
const STAFF: Permission[] = [
  "product:read",
  "product:write",
  "inventory:read",
  "inventory:write",
  "order:read",
  "order:write",
];
const ADMIN: Permission[] = [
  ...STAFF,
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
const EXPECTED: Record<Role, Permission[]> = {
  CUSTOMER: [],
  STAFF,
  ADMIN,
  SUPER_ADMIN: [...ALL_PERMISSIONS],
};

const cases = ROLES.flatMap((role) => ALL_PERMISSIONS.map((perm) => [role, perm] as const));

describe("can", () => {
  it.each(cases)("%s → %s matches the blueprint matrix", (role, perm) => {
    expect(can(role, perm)).toBe(EXPECTED[role].includes(perm));
  });

  it("reserves role management and the audit log for SUPER_ADMIN", () => {
    const holders = ROLES.filter((r) => can(r, "user:write") || can(r, "audit:read"));
    expect(holders).toEqual(["SUPER_ADMIN"]);
  });

  it.each([
    ["settings:read", ["ADMIN", "SUPER_ADMIN"]],
    ["settings:write", ["SUPER_ADMIN"]],
    ["user:reset-password", ["ADMIN", "SUPER_ADMIN"]],
    ["order:confirm-payment", ["ADMIN", "SUPER_ADMIN"]],
  ] as const)("grants %s only to %j (Phase 3b)", (perm, holders) => {
    expect(ROLES.filter((r) => can(r, perm))).toEqual(holders);
  });

  it("denies an unknown role instead of throwing", () => {
    expect(can("INTRUDER" as Role, "order:read")).toBe(false);
  });
});

describe("permissionsFor", () => {
  it("lists exactly the permissions a role holds", () => {
    expect([...permissionsFor("ADMIN")].sort()).toEqual([...ADMIN].sort());
  });

  it("returns a copy, so callers cannot grant themselves permissions", () => {
    const perms = permissionsFor("STAFF") as Permission[];
    perms.push("order:refund");
    expect(can("STAFF", "order:refund")).toBe(false);
  });

  it("returns no permissions for an unknown role", () => {
    expect(permissionsFor("INTRUDER" as Role)).toEqual([]);
  });
});

describe("isAdminRole", () => {
  it.each([
    ["CUSTOMER", false],
    ["STAFF", true],
    ["ADMIN", true],
    ["SUPER_ADMIN", true],
  ] as const)("%s → %s", (role, expected) => {
    expect(isAdminRole(role)).toBe(expected);
  });
});
