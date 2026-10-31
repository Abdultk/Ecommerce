import { describe, expect, it } from "vitest";
import {
  AdminOrderDetail,
  AdminOrderListItem,
  AdminProductDetail,
  AdminProfile,
  AnalyticsSummary,
  Iban,
  OrderDetail,
  PublicStoreConfig,
  StoreSettings,
  type Role,
} from "@hp/contracts";
import { z } from "zod";
import { MOCK_PASSWORD, MOCK_RESET_TOKEN, MOCK_TOTP_CODE, mockSessionFor } from "@test/mocks/accounts";
import { createStore } from "@test/mocks/db";
import { createAdminMockHandlers } from "@test/mocks/handlers";
import { MOCK_IBAN } from "@test/mocks/settings";
import { API, server } from "./server";

// Contract-level checks of the Phase 3b mock endpoints (docs/phase-3b-oman.md §3–§7).

type StaffRole = Exclude<Role, "CUSTOMER">;
type Options = { role?: StaffRole; body?: unknown; headers?: Record<string, string> };

async function call(method: string, path: string, options: Options = {}) {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (options.role) headers.Authorization = `Bearer ${mockSessionFor(options.role).accessToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = (await res.json()) as {
    success: boolean;
    data: unknown;
    error: { code: string; message: string } | null;
  };
  return { status: res.status, json };
}

const data = <T>(schema: z.ZodType<T>, res: { json: { data: unknown } }): T =>
  schema.parse(res.json.data);

const TRANSFER_ORDER = "ord_mock_01";

describe("mock store settings", () => {
  it("seeds an Omani store with a checksum-valid IBAN", async () => {
    const settings = data(StoreSettings, await call("GET", "/admin/settings", { role: "ADMIN" }));
    expect(settings.currency).toBe("OMR");
    expect(settings.vatRateBps).toBe(500);
    expect(settings.payments.bank?.iban).toBe(MOCK_IBAN);
    expect(Iban.safeParse(MOCK_IBAN).success).toBe(true);
  });

  it("serves the public store config without a session", async () => {
    const config = data(PublicStoreConfig, await call("GET", "/store"));
    expect(config).toMatchObject({ currency: "OMR", paymentMethods: ["card", "bank_transfer"] });
  });

  it("keeps settings:read from STAFF and settings:write from ADMIN", async () => {
    expect((await call("GET", "/admin/settings", { role: "STAFF" })).status).toBe(403);
    const write = await call("PATCH", "/admin/settings/general", {
      role: "ADMIN",
      body: { storeName: "X" },
    });
    expect(write.status).toBe(403);
  });

  it("updates general and shipping settings for SUPER_ADMIN", async () => {
    const general = await call("PATCH", "/admin/settings/general", {
      role: "SUPER_ADMIN",
      body: { vatRateBps: 525 },
    });
    expect(data(StoreSettings, general).vatRateBps).toBe(525);
    const shipping = await call("PATCH", "/admin/settings/shipping", {
      role: "SUPER_ADMIN",
      body: { freeShippingThresholdCents: null },
    });
    expect(data(StoreSettings, shipping).shipping.freeShippingThresholdCents).toBeNull();
  });

  it("needs a valid 2FA code to change bank details", async () => {
    const settings = data(StoreSettings, await call("GET", "/admin/settings", { role: "ADMIN" }));
    const bank = { ...settings.payments.bank!, bankName: "Bank Dhofar" };
    const missing = await call("PATCH", "/admin/settings/payments", {
      role: "SUPER_ADMIN",
      body: { bank },
    });
    expect(missing.status).toBe(400);
    const wrong = await call("PATCH", "/admin/settings/payments", {
      role: "SUPER_ADMIN",
      body: { bank, totpCode: "000000" },
    });
    expect(wrong.status).toBe(401);
    const ok = await call("PATCH", "/admin/settings/payments", {
      role: "SUPER_ADMIN",
      body: { bank, totpCode: MOCK_TOTP_CODE },
    });
    expect(data(StoreSettings, ok).payments.bank?.bankName).toBe("Bank Dhofar");
  });

  it("refuses to disable every payment method", async () => {
    const res = await call("PATCH", "/admin/settings/payments", {
      role: "SUPER_ADMIN",
      body: { cardEnabled: false, bankTransferEnabled: false },
    });
    expect(res.status).toBe(400);
  });

  it("locks the currency once orders exist", async () => {
    const res = await call("PUT", "/admin/settings/currency", {
      role: "SUPER_ADMIN",
      body: { currency: "USD", confirm: "USD", totpCode: MOCK_TOTP_CODE },
    });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("CURRENCY_LOCKED");
  });

  it("rescales stored amounts when no order exists", async () => {
    const empty = createStore();
    empty.update((db) => ({ ...db, orders: [] }));
    server.resetHandlers(...createAdminMockHandlers(API, empty));
    const before = empty.get().products[0]!.variants[0]!.priceCents;
    const res = await call("PUT", "/admin/settings/currency", {
      role: "SUPER_ADMIN",
      body: { currency: "USD", confirm: "USD", totpCode: MOCK_TOTP_CODE },
    });
    const settings = data(StoreSettings, res);
    expect(settings.currency).toBe("USD");
    expect(settings.shipping.standardCents).toBe(200);
    const product = await call("GET", `/admin/products/${empty.get().products[0]!.id}`, {
      role: "ADMIN",
    });
    expect(data(AdminProductDetail, product).variants[0]!.priceCents).toBe(before / 10);
    const summary = await call(
      "GET",
      "/admin/analytics/summary?from=2026-10-01&to=2026-10-02&interval=day",
      { role: "ADMIN" },
    );
    expect(data(AnalyticsSummary, summary).currency).toBe("USD");
  });
});

describe("mock password resets and profile", () => {
  const reset = (role: StaffRole, userId: string, body: unknown = {}) =>
    call("POST", `/admin/users/${userId}/password-reset`, { role, body });

  it("lets ADMIN reset a customer but only SUPER_ADMIN reset staff", async () => {
    const customer = await reset("ADMIN", "u_mock_cust_1");
    expect(customer.status).toBe(202);
    expect(customer.json.data).toEqual({ sent: true });
    expect((await reset("ADMIN", "u_mock_staff")).status).toBe(403);
    expect((await reset("SUPER_ADMIN", "u_mock_staff")).status).toBe(202);
    expect((await reset("STAFF", "u_mock_cust_1")).status).toBe(403);
  });

  it("refuses self-resets and 2FA resets of customers", async () => {
    expect((await reset("SUPER_ADMIN", "u_mock_owner")).status).toBe(403);
    expect((await reset("SUPER_ADMIN", "u_mock_cust_1", { resetTwoFactor: true })).status).toBe(
      400,
    );
  });

  it("re-invites staff when 2FA is reset, so they can't sign in until re-enrolled", async () => {
    await reset("SUPER_ADMIN", "u_mock_staff", { resetTwoFactor: true });
    const login = await call("POST", "/admin/auth/login", {
      body: { email: "staff@hearthandpan.test", password: MOCK_PASSWORD },
    });
    expect(login.status).toBe(401);
  });

  it("sets a staff password from a reset link once", async () => {
    const body = { token: MOCK_RESET_TOKEN, password: "a brand new passphrase" };
    expect((await call("POST", "/admin/auth/reset-password", { body })).status).toBe(200);
    expect((await call("POST", "/admin/auth/reset-password", { body })).status).toBe(400);
    const login = await call("POST", "/admin/auth/login", {
      body: { email: "staff@hearthandpan.test", password: body.password },
    });
    expect(login.status).toBe(200);
  });

  it("reads and renames the signed-in admin", async () => {
    const me = data(AdminProfile, await call("GET", "/admin/me", { role: "STAFF" }));
    expect(me.email).toBe("staff@hearthandpan.test");
    expect(me.totpEnabledAt).not.toBeNull();
    const renamed = await call("PATCH", "/admin/me", {
      role: "STAFF",
      body: { firstName: "Sami" },
    });
    expect(data(AdminProfile, renamed).firstName).toBe("Sami");
    expect((await call("GET", "/admin/me")).status).toBe(401);
  });

  it("changes the password only with the current password and a 2FA code", async () => {
    const body = {
      currentPassword: MOCK_PASSWORD,
      newPassword: "another long passphrase",
      totpCode: "000000",
    };
    expect((await call("POST", "/admin/me/password", { role: "ADMIN", body })).status).toBe(401);
    const ok = await call("POST", "/admin/me/password", {
      role: "ADMIN",
      body: { ...body, totpCode: MOCK_TOTP_CODE },
    });
    expect(ok.status).toBe(200);
    const revoke = await call("POST", "/admin/me/sessions/revoke-others", { role: "ADMIN" });
    expect(revoke.status).toBe(200);
  });
});

describe("mock orders: payment methods and transfers", () => {
  const confirm = (body: unknown, key = "key-1", role: StaffRole = "ADMIN") =>
    call("POST", `/admin/orders/${TRANSFER_ORDER}/confirm-transfer`, {
      role,
      body,
      headers: key ? { "Idempotency-Key": key } : {},
    });

  it("lists OMR orders with payment method and filters by it", async () => {
    const res = await call("GET", "/admin/orders?paymentMethod=bank_transfer", { role: "STAFF" });
    const rows = z.array(AdminOrderListItem).parse(res.json.data);
    expect(rows.map((r) => r.id)).toEqual(["ord_mock_01", "ord_mock_03"]);
    expect(rows[0]).toMatchObject({ currency: "OMR", paymentMethod: "bank_transfer" });
    expect(rows[0]!.paymentDueAt).not.toBeNull();
  });

  it("shows bank details on the pending transfer order", async () => {
    const detail = data(
      AdminOrderDetail,
      await call("GET", `/admin/orders/${TRANSFER_ORDER}`, { role: "STAFF" }),
    );
    expect(OrderDetail.parse(detail.order).bankTransfer?.reference).toBe(detail.order.number);
    expect(detail.order.shippingAddress.country).toBe("OM");
  });

  it("requires an Idempotency-Key and the exact total", async () => {
    const detail = data(
      AdminOrderDetail,
      await call("GET", `/admin/orders/${TRANSFER_ORDER}`, { role: "ADMIN" }),
    );
    const total = detail.order.totalCents;
    expect((await confirm({ receivedCents: total, bankReference: "R1" }, "")).status).toBe(400);
    const mismatch = await confirm({ receivedCents: total - 1, bankReference: "R1" });
    expect(mismatch.status).toBe(422);
    expect(mismatch.json.error?.code).toBe("AMOUNT_MISMATCH");
    expect(
      (await confirm({ receivedCents: total, bankReference: "R1" }, "k", "STAFF")).status,
    ).toBe(403);
  });

  it("confirms a transfer once and replays a retry with the same key", async () => {
    const detail = data(
      AdminOrderDetail,
      await call("GET", `/admin/orders/${TRANSFER_ORDER}`, { role: "ADMIN" }),
    );
    const body = { receivedCents: detail.order.totalCents, bankReference: "BMCT-77812" };
    const first = data(AdminOrderDetail, await confirm(body, "same-key"));
    expect(first.order.status).toBe("PAID");
    expect(first.order.bankTransfer).toBeNull();
    expect(first.transferBankReference).toBe("BMCT-77812");
    expect(first.paymentProvider).toBe("manual");
    expect((await confirm(body, "same-key")).status).toBe(200);
    expect((await confirm(body, "other-key")).status).toBe(409);
  });

  it("asks for a bank reference when refunding a transfer order", async () => {
    const without = await call("POST", "/admin/orders/ord_mock_03/refund", {
      role: "ADMIN",
      body: { amountCents: 1_000 },
    });
    expect(without.status).toBe(400);
    const refunded = await call("POST", "/admin/orders/ord_mock_03/refund", {
      role: "ADMIN",
      body: { amountCents: 1_000, bankReference: "BMCT-REF-1" },
    });
    const refund = data(AdminOrderDetail, refunded).refunds.at(-1);
    expect(refund).toMatchObject({ provider: "manual", bankReference: "BMCT-REF-1" });
  });

  it("refunds card orders through the card provider", async () => {
    const res = await call("POST", "/admin/orders/ord_mock_02/refund", {
      role: "ADMIN",
      body: { amountCents: 500 },
    });
    expect(data(AdminOrderDetail, res).refunds.at(-1)?.provider).toBe("amwal");
  });
});
