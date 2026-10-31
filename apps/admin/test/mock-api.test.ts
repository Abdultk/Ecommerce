import { describe, expect, it } from "vitest";
import {
  AdminOrderDetail,
  AdminProductDetail,
  AdminUserListItem,
  AuditLogEntry,
  Category,
  CouponView,
  InventoryItem,
  PresignResult,
  StockMovementView,
  type Role,
} from "@hp/contracts";
import { z } from "zod";
import {
  MOCK_ACCOUNTS,
  MOCK_INVITE_TOKEN,
  MOCK_PASSWORD,
  MOCK_TOTP_CODE,
  mockSessionFor,
} from "@test/mocks/accounts";
import { API } from "./server";

// Contract-level checks of the in-memory mock API: same rules and errors as the real one.

type StaffRole = Exclude<Role, "CUSTOMER">;

async function call(
  method: string,
  path: string,
  options: { role?: StaffRole; body?: unknown } = {},
): Promise<{
  status: number;
  json: {
    success: boolean;
    data: unknown;
    error: { code: string; message: string; details?: unknown } | null;
    meta?: { total: number };
  };
}> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.role) headers.Authorization = `Bearer ${mockSessionFor(options.role).accessToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, json: await res.json() };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const body = value as { success: boolean; data: unknown; error: { message: string } | null };
  if (!body.success) throw new Error(body.error?.message ?? "request failed");
  return schema.parse(body.data);
}

describe("mock admin auth", () => {
  const unenrolled = MOCK_ACCOUNTS.find((a) => !a.enrolled)!;

  it("refuses password login for an admin who has not finished 2FA enrollment", async () => {
    const res = await call("POST", "/admin/auth/login", {
      body: { email: unenrolled.user.email, password: MOCK_PASSWORD },
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toEqual({
      code: "FORBIDDEN",
      message: "Finish setting up your account with the link in your invite email.",
    });
  });

  it("never returns an otpauthUrl from login", async () => {
    const enrolled = MOCK_ACCOUNTS.find((a) => a.enrolled)!;
    const res = await call("POST", "/admin/auth/login", {
      body: { email: enrolled.user.email, password: MOCK_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.json.data).not.toHaveProperty("otpauthUrl");
  });

  it("enrolls through the invite: accept-invite, then 2FA, then normal login works", async () => {
    const newPassword = "a-brand-new-password";
    const accepted = await call("POST", "/admin/auth/accept-invite", {
      body: { token: MOCK_INVITE_TOKEN, password: newPassword },
    });
    expect(accepted.status).toBe(200);
    const challenge = accepted.json.data as { challengeToken: string; otpauthUrl: string };
    expect(accepted.json.data).toMatchObject({ enrollmentRequired: true });
    expect(challenge.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const verified = await call("POST", "/admin/auth/2fa", {
      body: { challengeToken: challenge.challengeToken, code: MOCK_TOTP_CODE },
    });
    expect(verified.status).toBe(200);

    const again = await call("POST", "/admin/auth/accept-invite", {
      body: { token: MOCK_INVITE_TOKEN, password: newPassword },
    });
    expect(again.status).toBe(400);
    expect(again.json.error?.message).toBe("This link has expired or was already used.");

    const login = await call("POST", "/admin/auth/login", {
      body: { email: unenrolled.user.email, password: newPassword },
    });
    expect(login.status).toBe(200);
  });

  it("rejects a short password on accept-invite", async () => {
    const res = await call("POST", "/admin/auth/accept-invite", {
      body: { token: MOCK_INVITE_TOKEN, password: "short" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { password: ["Use at least 12 characters."] },
    });
  });
});

describe("mock permissions", () => {
  it.each([
    ["STAFF", "DELETE", "/admin/products/p_sample_01", 403],
    ["STAFF", "GET", "/admin/users", 403],
    ["ADMIN", "GET", "/admin/audit-log", 403],
    ["STAFF", "GET", "/admin/coupons", 403],
    ["SUPER_ADMIN", "GET", "/admin/audit-log", 200],
  ] as const)("%s %s %s → %i", async (role, method, path, status) => {
    expect((await call(method, path, { role })).status).toBe(status);
  });

  it("requires a token", async () => {
    expect((await call("GET", "/admin/orders")).status).toBe(401);
  });
});

describe("mock products", () => {
  it("sorts server-side", async () => {
    const res = await call("GET", "/admin/products?sort=price&dir=asc&pageSize=100", {
      role: "STAFF",
    });
    const prices = (res.json.data as { fromPriceCents: number }[]).map((r) => r.fromPriceCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("patches an existing variant and creates a new one with initialStock", async () => {
    const res = await call("PATCH", "/admin/products/p_sample_01", {
      role: "STAFF",
      body: {
        variants: [
          { id: "v_sample_01_1", priceCents: 3699 },
          { sku: "IV-SK14", name: "14 inch", priceCents: 5499, initialStock: 3 },
        ],
      },
    });
    expect(res.status).toBe(200);
    const detail = parse(AdminProductDetail, res.json);
    expect(detail.variants.find((v) => v.id === "v_sample_01_1")?.priceCents).toBe(3699);
    expect(detail.variants.find((v) => v.sku === "IV-SK14")?.stockOnHand).toBe(3);
    expect(detail.variants).toHaveLength(3);
  });

  it("rejects stock on an existing variant", async () => {
    const res = await call("PATCH", "/admin/products/p_sample_01", {
      role: "STAFF",
      body: { variants: [{ id: "v_sample_01_1", stockOnHand: 99 }] },
    });
    expect(res.status).toBe(400);
  });

  it("archives on delete", async () => {
    const res = await call("DELETE", "/admin/products/p_sample_02", { role: "ADMIN" });
    expect(parse(AdminProductDetail, res.json).status).toBe("ARCHIVED");
  });

  it("presigns an upload and accepts the PUT", async () => {
    const res = await call("POST", "/admin/uploads/presign", {
      role: "STAFF",
      body: { contentType: "image/png", contentLength: 1000 },
    });
    const presign = parse(PresignResult, res.json);
    const put = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: "x",
    });
    expect(put.ok).toBe(true);
  });
});

describe("mock categories", () => {
  it("refuses to delete a category with products or subcategories", async () => {
    const res = await call("DELETE", "/admin/categories/cat_cookware", { role: "STAFF" });
    expect(res.status).toBe(409);
    expect(res.json.error?.message).toBe("Move this category's products and subcategories first.");
  });

  it("creates, moves and deletes an empty category", async () => {
    const created = await call("POST", "/admin/categories", {
      role: "STAFF",
      body: { name: "Bakeware", slug: "bakeware" },
    });
    expect(created.status).toBe(201);
    const cat = created.json.data as { id: string; parentId: string | null };
    expect(cat.parentId).toBeNull();
    const moved = await call("PATCH", `/admin/categories/${cat.id}`, {
      role: "STAFF",
      body: { name: "Bakeware", slug: "bakeware", parentId: "cat_cookware", position: 3 },
    });
    expect(moved.status).toBe(200);
    const tree = parse(z.array(Category), (await call("GET", "/categories")).json);
    expect(tree.find((c) => c.id === "cat_cookware")?.children.map((c) => c.id)).toContain(cat.id);
    const removed = await call("DELETE", `/admin/categories/${cat.id}`, { role: "STAFF" });
    expect(removed.json.data).toEqual({ deleted: true });
  });

  it("refuses to move a category inside itself", async () => {
    const res = await call("PATCH", "/admin/categories/cat_cookware", {
      role: "STAFF",
      body: { name: "Cookware", slug: "cookware", parentId: "cat_skillets", position: 0 },
    });
    expect(res.status).toBe(400);
    expect(res.json.error?.message).toBe("A category can't be placed inside itself.");
  });
});

describe("mock orders", () => {
  const firstWith = async (status: string) => {
    const res = await call("GET", `/admin/orders?status=${status}`, { role: "ADMIN" });
    return (res.json.data as { id: string }[])[0]!.id;
  };

  it("offers only the admin-settable transitions from ORDER_TRANSITIONS", async () => {
    const id = await firstWith("PAID");
    const detail = parse(
      AdminOrderDetail,
      (await call("GET", `/admin/orders/${id}`, { role: "STAFF" })).json,
    );
    expect(detail.allowedStatuses).toEqual(["PROCESSING"]);
    expect(detail.canCancel).toBe(true);

    const bad = await call("PATCH", `/admin/orders/${id}/status`, {
      role: "STAFF",
      body: { status: "DELIVERED" },
    });
    expect(bad.status).toBe(409);
  });

  it("requires a tracking number to ship", async () => {
    const id = await firstWith("PROCESSING");
    const res = await call("PATCH", `/admin/orders/${id}/status`, {
      role: "STAFF",
      body: { status: "SHIPPED" },
    });
    expect(res.status).toBe(400);
  });

  it("caps refunds at the remaining refundable amount and fully refunds", async () => {
    const id = await firstWith("DELIVERED");
    const before = parse(
      AdminOrderDetail,
      (await call("GET", `/admin/orders/${id}`, { role: "ADMIN" })).json,
    );
    const over = await call("POST", `/admin/orders/${id}/refund`, {
      role: "ADMIN",
      body: { amountCents: before.refundableCents + 1 },
    });
    expect(over.status).toBe(400);

    const staff = await call("POST", `/admin/orders/${id}/refund`, {
      role: "STAFF",
      body: { amountCents: 100 },
    });
    expect(staff.status).toBe(403);

    const full = await call("POST", `/admin/orders/${id}/refund`, {
      role: "ADMIN",
      body: { amountCents: before.refundableCents },
    });
    const after = parse(AdminOrderDetail, full.json);
    expect(after.order.status).toBe("REFUNDED");
    expect(after.refundableCents).toBe(0);
    expect(after.order.refundState).toBe("FULL");
  });

  it("cancels a cancellable order", async () => {
    const id = await firstWith("PENDING_PAYMENT");
    const res = await call("POST", `/admin/orders/${id}/cancel`, {
      role: "STAFF",
      body: { reason: "Customer asked" },
    });
    expect(parse(AdminOrderDetail, res.json).order.status).toBe("CANCELLED");
  });
});

describe("mock inventory and coupons", () => {
  it("adjusts stock and writes a ledger entry", async () => {
    const res = await call("POST", "/admin/inventory/adjust", {
      role: "STAFF",
      body: { variantId: "v_sample_01_1", delta: 6, reason: "RESTOCK", note: "PO 12" },
    });
    expect(parse(InventoryItem, res.json).stockOnHand).toBe(30);
    const moves = await call("GET", "/admin/inventory/v_sample_01_1/movements?page=1", {
      role: "STAFF",
    });
    const first = parse(z.array(StockMovementView), moves.json)[0]!;
    expect(first).toMatchObject({ delta: 6, reason: "RESTOCK", note: "PO 12" });
  });

  it("rejects a SALE adjustment and stock below zero", async () => {
    const sale = await call("POST", "/admin/inventory/adjust", {
      role: "STAFF",
      body: { variantId: "v_sample_01_1", delta: -1, reason: "SALE" },
    });
    expect(sale.status).toBe(400);
    const negative = await call("POST", "/admin/inventory/adjust", {
      role: "STAFF",
      body: { variantId: "v_sample_02_2", delta: -1, reason: "DAMAGE" },
    });
    expect(negative.status).toBe(400);
    expect(negative.json.error?.message).toBe(
      "That would leave -1 on hand, but 0 are reserved by open checkouts.",
    );
  });

  it("creates, updates and deletes an unused coupon; deactivates a used one", async () => {
    const created = await call("POST", "/admin/coupons", {
      role: "ADMIN",
      body: { code: "fall5", type: "FIXED", value: 500 },
    });
    expect(created.status).toBe(201);
    const coupon = parse(CouponView, created.json);
    expect(coupon.code).toBe("FALL5");
    const updated = await call("PATCH", `/admin/coupons/${coupon.id}`, {
      role: "ADMIN",
      body: { code: "FALL5", type: "PERCENT", value: 15 },
    });
    expect(parse(CouponView, updated.json)).toMatchObject({ type: "PERCENT", value: 15 });
    const removed = await call("DELETE", `/admin/coupons/${coupon.id}`, { role: "ADMIN" });
    expect(removed.json.data).toEqual({ deleted: true, deactivated: false });
    const used = await call("DELETE", "/admin/coupons/cpn_mock_1", { role: "ADMIN" });
    expect(used.json.data).toEqual({ deleted: false, deactivated: true });
    const list = parse(
      z.array(CouponView),
      (await call("GET", "/admin/coupons?page=1", { role: "ADMIN" })).json,
    );
    expect(list.find((c) => c.id === coupon.id)).toBeUndefined();
    expect(list.find((c) => c.id === "cpn_mock_1")?.isActive).toBe(false);
  });

  it("rejects a duplicate coupon code", async () => {
    const res = await call("POST", "/admin/coupons", {
      role: "ADMIN",
      body: { code: "WELCOME10", type: "PERCENT", value: 10 },
    });
    expect(res.status).toBe(409);
  });
});

describe("mock users and audit", () => {
  const owner = mockSessionFor("SUPER_ADMIN").user;
  const admin = mockSessionFor("ADMIN").user;

  it("refuses self-demotion and self-disable", async () => {
    const res = await call("PATCH", `/admin/users/${owner.id}`, {
      role: "SUPER_ADMIN",
      body: { role: "ADMIN" },
    });
    expect(res.status).toBe(403);
    expect(res.json.error?.message).toBe("You can't change your own role or access.");
  });

  it("only SUPER_ADMIN may change roles", async () => {
    const res = await call("PATCH", `/admin/users/${owner.id}`, {
      role: "ADMIN",
      body: { disabled: true },
    });
    expect(res.status).toBe(403);
  });

  it("changes another user's role and records it in the audit log", async () => {
    const res = await call("PATCH", `/admin/users/${admin.id}`, {
      role: "SUPER_ADMIN",
      body: { role: "STAFF" },
    });
    expect(parse(AdminUserListItem, res.json).role).toBe("STAFF");
    const log = parse(
      z.array(AuditLogEntry),
      (await call("GET", "/admin/audit-log?entity=User", { role: "SUPER_ADMIN" })).json,
    );
    expect(log[0]).toMatchObject({ action: "user.update", entityId: admin.id });
    expect(log[0]?.before).toMatchObject({ role: "ADMIN" });
    expect(log[0]?.after).toMatchObject({ role: "STAFF" });
  });

  it("invites staff and rejects an existing email", async () => {
    const body = {
      email: "chef@hearthandpan.test",
      firstName: "Lee",
      lastName: "Park",
      role: "STAFF",
    };
    const res = await call("POST", "/admin/users/invite", { role: "SUPER_ADMIN", body });
    expect(res.status).toBe(201);
    expect(parse(AdminUserListItem, res.json)).toMatchObject({
      email: body.email,
      twoFactorEnabled: false,
    });
    expect((await call("POST", "/admin/users/invite", { role: "SUPER_ADMIN", body })).status).toBe(
      409,
    );
  });

  it("resends an invite, which un-enrolls 2FA", async () => {
    const res = await call("POST", `/admin/users/${admin.id}/invite`, { role: "SUPER_ADMIN" });
    expect(parse(AdminUserListItem, res.json).twoFactorEnabled).toBe(false);
    const self = await call("POST", `/admin/users/${owner.id}/invite`, { role: "SUPER_ADMIN" });
    expect(self.status).toBe(403);
  });
});
