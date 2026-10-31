import { http } from "msw";
import {
  CurrencyChangeInput,
  PaymentSettings,
  SettingsGeneralPatch,
  SettingsPaymentsPatch,
  SettingsShippingPatch,
  StoreSettings,
  rescaleMinor,
  type CurrencyCode,
  type PublicStoreConfig,
} from "@hp/contracts";
import { MOCK_TOTP_CODE } from "../accounts";
import {
  authorize,
  errorResponse,
  invalid,
  okResponse,
  readJson,
  withAudit,
  type MockContext,
} from "../http";
import type { MockDb, MockUser } from "../types";

// Mirrors the Phase 3b settings endpoints (docs/phase-3b-oman.md §3).

const BAD_CODE = "That 2FA code didn't work. Check your authenticator app.";
const LOCKED =
  "The store currency is locked because orders exist. Orders keep the currency they were placed in.";

/** Audit view of the settings: bank account number and IBAN masked to the last 4. */
function forAudit(s: StoreSettings): unknown {
  const bank = s.payments.bank;
  const mask = (v: string) => `••••${v.slice(-4)}`;
  return {
    ...s,
    payments: {
      ...s.payments,
      bank: bank && { ...bank, accountNumber: mask(bank.accountNumber), iban: mask(bank.iban) },
    },
  };
}

export function toPublicConfig(s: StoreSettings): PublicStoreConfig {
  const enabledManual = s.payments.manualMethods.filter((m) => m.enabled);
  return {
    storeName: s.storeName,
    currency: s.currency,
    vatRateBps: s.vatRateBps,
    freeShippingThresholdCents: s.shipping.freeShippingThresholdCents,
    paymentMethods: [
      ...(s.payments.cardEnabled ? (["card"] as const) : []),
      ...(s.payments.bankTransferEnabled ? (["bank_transfer"] as const) : []),
      ...(enabledManual.length > 0 ? (["manual"] as const) : []),
    ],
    manualMethods: enabledManual.map(({ id, label, instructions }) => ({
      id,
      label,
      instructions,
    })),
  };
}

/** Every stored amount moved to the new currency's minor units (no exchange rate). */
function rescaleStore(db: MockDb, to: CurrencyCode): MockDb {
  const from = db.settings.currency;
  const r = (n: number) => rescaleMinor(n, from, to);
  const rn = (n: number | null) => (n === null ? null : r(n));
  const { shipping } = db.settings;
  return {
    ...db,
    products: db.products.map((p) => ({
      ...p,
      variants: p.variants.map((v) => ({
        ...v,
        priceCents: r(v.priceCents),
        compareAtPriceCents: rn(v.compareAtPriceCents),
        costCents: rn(v.costCents),
      })),
    })),
    coupons: db.coupons.map((c) => ({
      ...c,
      value: c.type === "FIXED" ? r(c.value) : c.value,
      minSubtotalCents: r(c.minSubtotalCents),
    })),
    settings: {
      ...db.settings,
      currency: to,
      shipping: {
        ...shipping,
        standardCents: r(shipping.standardCents),
        expressCents: r(shipping.expressCents),
        freeShippingThresholdCents: rn(shipping.freeShippingThresholdCents),
      },
    },
  };
}

export function settingsRoutes(ctx: MockContext) {
  const { baseUrl, store } = ctx;

  /** Saves new settings with an audit entry and answers with them. */
  const save = (caller: MockUser, action: string, change: (db: MockDb) => MockDb) => {
    const before = store.get().settings;
    const db = store.update((current) => {
      const changed = change(current);
      const next = { ...changed, settings: { ...changed.settings, updatedAt: ctx.now() } };
      return withAudit(ctx, next, {
        actor: caller,
        action,
        entity: "StoreSettings",
        entityId: "default",
        before: forAudit(before),
        after: forAudit(next.settings),
      });
    });
    return okResponse(StoreSettings.parse(db.settings));
  };

  const writer = (request: Request) => authorize(ctx, request, "settings:write");

  return [
    http.get(`${baseUrl}/store`, () => okResponse(toPublicConfig(store.get().settings))),

    http.get(`${baseUrl}/admin/settings`, ({ request }) => {
      const caller = authorize(ctx, request, "settings:read");
      if (caller instanceof Response) return caller;
      return okResponse(store.get().settings);
    }),

    http.patch(`${baseUrl}/admin/settings/general`, async ({ request }) => {
      const caller = writer(request);
      if (caller instanceof Response) return caller;
      const input = SettingsGeneralPatch.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      return save(caller, "settings.general", (db) => ({
        ...db,
        settings: { ...db.settings, ...input.data },
      }));
    }),

    http.patch(`${baseUrl}/admin/settings/shipping`, async ({ request }) => {
      const caller = writer(request);
      if (caller instanceof Response) return caller;
      const input = SettingsShippingPatch.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      return save(caller, "settings.shipping", (db) => ({
        ...db,
        settings: { ...db.settings, shipping: { ...db.settings.shipping, ...input.data } },
      }));
    }),

    http.patch(`${baseUrl}/admin/settings/payments`, async ({ request }) => {
      const caller = writer(request);
      if (caller instanceof Response) return caller;
      const input = SettingsPaymentsPatch.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      const { totpCode, ...changes } = input.data;
      if (totpCode !== undefined && totpCode !== MOCK_TOTP_CODE) {
        return errorResponse("UNAUTHENTICATED", BAD_CODE);
      }
      const merged = PaymentSettings.safeParse({ ...store.get().settings.payments, ...changes });
      if (!merged.success) return invalid(merged.error);
      return save(caller, "settings.payments", (db) => ({
        ...db,
        settings: { ...db.settings, payments: merged.data },
      }));
    }),

    http.put(`${baseUrl}/admin/settings/currency`, async ({ request }) => {
      const caller = writer(request);
      if (caller instanceof Response) return caller;
      const input = CurrencyChangeInput.safeParse(await readJson(request));
      if (!input.success) return invalid(input.error);
      if (input.data.totpCode !== MOCK_TOTP_CODE) return errorResponse("UNAUTHENTICATED", BAD_CODE);
      if (store.get().orders.length > 0) return errorResponse("CURRENCY_LOCKED", LOCKED);
      return save(caller, "settings.currency", (db) => rescaleStore(db, input.data.currency));
    }),
  ];
}
