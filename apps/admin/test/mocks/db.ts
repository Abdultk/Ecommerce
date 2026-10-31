import { PublicUser, type AuditLogEntry, type CouponView } from "@hp/contracts";
import { FIXTURE_CDN_URL } from "@/lib/config";
import { MOCK_ACCOUNTS, MOCK_INVITE_TOKEN, MOCK_PASSWORD, MOCK_RESET_TOKEN } from "./accounts";
import { seedCategories, seedProducts } from "./products";
import { MOCK_CUSTOMERS, seedOrders } from "./seed-orders";
import { seedSettings, toStoreMinor } from "./settings";
import type { MockDb, MockMovement, MockUser } from "./types";

// Seed data and an immutable store for the mock API. Each handler set gets its
// own store, so tests never share state.

const SEED_DATE = "2026-01-05T09:00:00.000Z";
const LAST_LOGIN = "2026-10-08T16:20:00.000Z";

function seedUsers(): MockUser[] {
  const staff = MOCK_ACCOUNTS.map((a): MockUser => ({
    user: a.user,
    disabled: false,
    twoFactorEnabled: a.enrolled,
    password: MOCK_PASSWORD,
    createdAt: SEED_DATE,
    lastLoginAt: a.enrolled ? LAST_LOGIN : null,
  }));
  const customers = MOCK_CUSTOMERS.map((c, i): MockUser => ({
    user: PublicUser.parse({ ...c, role: "CUSTOMER", emailVerified: i !== 2 }),
    disabled: false,
    twoFactorEnabled: false,
    password: MOCK_PASSWORD,
    createdAt: new Date(Date.UTC(2026, 2, 1 + i * 20)).toISOString(),
    lastLoginAt: null,
  }));
  return [...staff, ...customers];
}

function seedCoupons(): CouponView[] {
  const base = {
    maxRedemptions: null,
    perCustomerLimit: 1,
    categoryIds: [],
    createdAt: SEED_DATE,
  };
  return [
    {
      ...base,
      id: "cpn_mock_1",
      code: "WELCOME10",
      type: "PERCENT",
      value: 10,
      minSubtotalCents: 0,
      redemptions: 37,
      startsAt: null,
      endsAt: null,
      isActive: true,
    },
    {
      ...base,
      id: "cpn_mock_2",
      code: "FREESHIP30",
      type: "FREE_SHIPPING",
      value: 0,
      minSubtotalCents: 30_000,
      perCustomerLimit: null,
      redemptions: 112,
      startsAt: "2026-09-01T00:00:00.000Z",
      endsAt: "2026-12-31T00:00:00.000Z",
      isActive: true,
    },
    {
      ...base,
      id: "cpn_mock_3",
      code: "SPRING5",
      type: "FIXED",
      value: toStoreMinor(500),
      minSubtotalCents: toStoreMinor(4000),
      maxRedemptions: 200,
      redemptions: 200,
      startsAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-05-31T00:00:00.000Z",
      isActive: false,
    },
  ];
}

function seedMovements(db: Pick<MockDb, "products">): MockMovement[] {
  return db.products.flatMap((p) =>
    p.variants
      .filter((v) => v.stockOnHand > 0)
      .map((v) => ({
        id: `mov_seed_${v.id}`,
        variantId: v.id,
        delta: v.stockOnHand,
        reason: "RESTOCK" as const,
        note: "Opening stock",
        orderNumber: null,
        actorEmail: "owner@hearthandpan.test",
        createdAt: p.createdAt,
      })),
  );
}

function seedAudit(): AuditLogEntry[] {
  const owner = MOCK_ACCOUNTS.find((a) => a.user.role === "SUPER_ADMIN")!.user;
  const admin = MOCK_ACCOUNTS.find((a) => a.user.role === "ADMIN")!.user;
  return [
    {
      id: "aud_seed_2",
      actorId: admin.id,
      actorEmail: admin.email,
      action: "coupon.update",
      entity: "Coupon",
      entityId: "cpn_mock_3",
      before: { code: "SPRING5", isActive: true },
      after: { code: "SPRING5", isActive: false },
      ip: "203.0.113.24",
      createdAt: "2026-06-01T10:15:00.000Z",
    },
    {
      id: "aud_seed_1",
      actorId: owner.id,
      actorEmail: owner.email,
      action: "user.invite",
      entity: "User",
      entityId: "u_mock_new_admin",
      before: null,
      after: { email: "new.admin@hearthandpan.test", role: "ADMIN" },
      ip: "203.0.113.10",
      createdAt: "2026-05-20T08:00:00.000Z",
    },
  ];
}

/** Earlier export jobs, so the reports list is not empty in mock mode. */
function seedReports(): MockDb["reports"] {
  const admin = MOCK_ACCOUNTS.find((a) => a.user.role === "ADMIN")!.user;
  const base = { requestedByEmail: admin.email, downloadUrl: null, downloadExpiresAt: null };
  return [
    {
      ...base,
      id: "rep_seed_2",
      type: "inventory",
      format: "xlsx",
      status: "failed",
      range: { from: "2026-10-09T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" },
      rowCount: null,
      error: "The export timed out. Try a shorter range.",
      createdAt: "2026-10-09T08:30:00.000Z",
      completedAt: "2026-10-09T08:31:10.000Z",
    },
    {
      ...base,
      id: "rep_seed_1",
      type: "sales-by-day",
      format: "csv",
      status: "done",
      range: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
      rowCount: 30,
      error: null,
      // Long-expired signed link: the UI offers to fetch a fresh one.
      downloadUrl: `${FIXTURE_CDN_URL}/reports/rep_seed_1.csv`,
      downloadExpiresAt: "2026-10-01T07:15:00.000Z",
      createdAt: "2026-10-01T07:00:00.000Z",
      completedAt: "2026-10-01T07:00:20.000Z",
    },
    {
      ...base,
      id: "rep_seed_0",
      type: "customers",
      format: "csv",
      // Past the 7-day retention: the API deleted the file and keeps the job as a record.
      status: "expired",
      range: { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
      rowCount: 118,
      error: null,
      createdAt: "2026-09-01T06:00:00.000Z",
      completedAt: "2026-09-01T06:00:40.000Z",
    },
  ];
}

export function createSeedDb(): MockDb {
  const products = seedProducts();
  const settings = seedSettings();
  const refundActor = MOCK_ACCOUNTS.find((a) => a.user.role === "ADMIN")!.user;
  return Object.freeze({
    users: seedUsers(),
    invites: [{ token: MOCK_INVITE_TOKEN, userId: "u_mock_new_admin" }],
    resetTokens: [{ token: MOCK_RESET_TOKEN, userId: "u_mock_staff" }],
    challenges: [],
    refreshUserId: null,
    categories: seedCategories(),
    products,
    settings,
    orders: seedOrders(refundActor.email, settings),
    movements: seedMovements({ products }),
    coupons: seedCoupons(),
    audit: seedAudit(),
    reports: seedReports(),
  });
}

export type MockStore = {
  get(): MockDb;
  /** Replaces the whole database with the result of `change`; never mutates. */
  update(change: (db: MockDb) => MockDb): MockDb;
};

export function createStore(initial: MockDb = createSeedDb()): MockStore {
  let current = initial;
  return {
    get: () => current,
    update(change) {
      current = Object.freeze(change(current));
      return current;
    },
  };
}
