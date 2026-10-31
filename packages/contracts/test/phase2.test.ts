import { describe, expect, it } from "vitest";
import {
  AdminCategoryInput,
  AdminInventoryQuery,
  AdminOrderDetail,
  AdminOrderListItem,
  AdminProductDetail,
  AdminUserListItem,
  AdminUserQuery,
  AuditLogEntry,
  CouponView,
  InventoryItem,
  StockMovementView,
} from "../src/admin";
import { AcceptInviteInput, AdminInviteInput } from "../src/auth";
import { CustomerOrderQuery } from "../src/orders";

const NOW = "2026-10-10T12:00:00Z";
const address = {
  fullName: "Ada Cook",
  line1: "1 Market St",
  city: "San Francisco",
  region: "CA",
  postalCode: "94105",
  country: "US",
};

describe("staff invites", () => {
  it("invites staff roles but never customers", () => {
    const base = { email: " New@Example.test ", firstName: "Sam", lastName: "Lee" };
    expect(AdminInviteInput.parse({ ...base, role: "STAFF" }).email).toBe("new@example.test");
    expect(AdminInviteInput.safeParse({ ...base, role: "CUSTOMER" }).success).toBe(false);
  });

  it("requires a strong password when accepting", () => {
    expect(AcceptInviteInput.safeParse({ token: "t".repeat(32), password: "short" }).success).toBe(
      false,
    );
    expect(
      AcceptInviteInput.safeParse({ token: "t".repeat(32), password: "a long enough passphrase" })
        .success,
    ).toBe(true);
  });
});

describe("admin product detail", () => {
  it("includes stock, cost and image keys for the edit form", () => {
    const detail = AdminProductDetail.parse({
      id: "p1",
      slug: "skillet",
      name: "Skillet",
      brand: null,
      categoryId: "c1",
      description: "<p>Pan</p>",
      material: null,
      careInstructions: null,
      dishwasherSafe: null,
      inductionCompatible: true,
      ovenSafeToF: 500,
      status: "ACTIVE",
      images: [
        {
          id: "i1",
          key: "products/2026/0f8fad5b-d9cb-469f-a165-70867728950e.webp",
          url: "https://cdn.example.test/x.webp",
          alt: "",
          position: 0,
        },
      ],
      variants: [
        {
          id: "v1",
          sku: "SK-10",
          name: "10 in",
          priceCents: 3499,
          compareAtPriceCents: null,
          costCents: 1800,
          stockOnHand: 10,
          stockReserved: 2,
          lowStockThreshold: 5,
          weightGrams: null,
          attributes: {},
          isActive: true,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(detail.variants[0]?.stockReserved).toBe(2);
  });
});

describe("categories", () => {
  it("defaults to a top-level category at position 0", () => {
    expect(AdminCategoryInput.parse({ name: "Bakeware", slug: "bakeware" })).toEqual({
      name: "Bakeware",
      slug: "bakeware",
      parentId: null,
      position: 0,
    });
  });
});

describe("admin orders", () => {
  it("parses a list row", () => {
    const row = AdminOrderListItem.parse({
      id: "o1",
      number: "HP-2026-000001",
      status: "PAID",
      email: "ada@example.test",
      customerName: "Ada Cook",
      itemCount: 2,
      totalCents: 7_575,
      refundedCents: 0,
      createdAt: NOW,
      paidAt: NOW,
      currency: "OMR",
      paymentMethod: "card",
      paymentLabel: null,
      paymentDueAt: null,
    });
    expect(row.number).toBe("HP-2026-000001");
  });

  it("wraps the customer-facing order with admin-only context", () => {
    const detail = AdminOrderDetail.parse({
      order: {
        id: "o1",
        number: "HP-2026-000001",
        status: "PAID",
        totalCents: 1000,
        itemCount: 1,
        createdAt: NOW,
        currency: "OMR",
        paymentMethod: "card",
        paymentLabel: null,
        paymentDueAt: null,
        bankTransfer: null,
        manualPayment: null,
        email: "ada@example.test",
        items: [
          {
            id: "i1",
            variantId: "v1",
            productName: "P",
            variantName: "V",
            sku: "S-1",
            unitPriceCents: 1000,
            quantity: 1,
            lineTotalCents: 1000,
          },
        ],
        totals: {
          subtotalCents: 1000,
          discountCents: 0,
          shippingCents: 0,
          taxCents: 0,
          totalCents: 1000,
        },
        refundedCents: 0,
        refundState: "NONE",
        shippingAddress: address,
        shippingMethod: "standard",
        trackingNumber: null,
        carrier: null,
        estimatedDeliveryAt: null,
        couponCode: null,
        paidAt: NOW,
        events: [],
      },
      customer: { id: "u1", email: "ada@example.test", name: "Ada Cook" },
      paymentIntentId: "pi_123",
      paymentProvider: "stripe",
      transferBankReference: null,
      transferConfirmedByEmail: null,
      refunds: [],
      allowedStatuses: ["PROCESSING"],
      canCancel: true,
      refundableCents: 1000,
    });
    expect(detail.allowedStatuses).toEqual(["PROCESSING"]);
  });
});

describe("inventory", () => {
  it("parses an inventory row and a ledger entry", () => {
    expect(
      InventoryItem.parse({
        variantId: "v1",
        productId: "p1",
        productName: "Skillet",
        variantName: "10 in",
        sku: "SK-10",
        stockOnHand: 3,
        stockReserved: 1,
        stockAvailable: 2,
        lowStockThreshold: 5,
        lowStock: true,
        isActive: true,
      }).lowStock,
    ).toBe(true);
    expect(
      StockMovementView.parse({
        id: "m1",
        delta: -1,
        reason: "SALE",
        note: null,
        orderNumber: "HP-2026-000001",
        actorEmail: null,
        createdAt: NOW,
      }).reason,
    ).toBe("SALE");
  });

  it("filters by low stock", () => {
    expect(AdminInventoryQuery.parse({ lowStock: "true" })).toMatchObject({
      lowStock: true,
      page: 1,
    });
  });
});

describe("coupons, users, audit", () => {
  it("parses a coupon view with ISO dates", () => {
    const coupon = CouponView.parse({
      id: "c1",
      code: "WELCOME10",
      type: "PERCENT",
      value: 10,
      minSubtotalCents: 5000,
      maxRedemptions: null,
      perCustomerLimit: 1,
      redemptions: 3,
      startsAt: null,
      endsAt: "2026-12-31T00:00:00Z",
      isActive: true,
      categoryIds: [],
      createdAt: NOW,
    });
    expect(coupon.redemptions).toBe(3);
  });

  it("parses a user row and query", () => {
    expect(
      AdminUserListItem.parse({
        id: "u1",
        email: "ada@example.test",
        firstName: "Ada",
        lastName: "Cook",
        role: "CUSTOMER",
        disabled: false,
        emailVerified: true,
        twoFactorEnabled: false,
        orderCount: 4,
        createdAt: NOW,
        lastLoginAt: null,
      }).orderCount,
    ).toBe(4);
    expect(AdminUserQuery.parse({ role: "STAFF" })).toMatchObject({ role: "STAFF", pageSize: 24 });
  });

  it("parses an audit entry with arbitrary before/after JSON", () => {
    const entry = AuditLogEntry.parse({
      id: "a1",
      actorId: "u1",
      actorEmail: "boss@example.test",
      action: "PATCH /admin/orders/:id/status",
      entity: "order",
      entityId: "o1",
      before: { status: "PAID" },
      after: { status: "PROCESSING" },
      ip: "203.0.113.7",
      createdAt: NOW,
    });
    expect(entry.after).toEqual({ status: "PROCESSING" });
  });
});

describe("customer order list", () => {
  it("pages with defaults", () => {
    expect(CustomerOrderQuery.parse({})).toEqual({ page: 1, pageSize: 24 });
  });
});
