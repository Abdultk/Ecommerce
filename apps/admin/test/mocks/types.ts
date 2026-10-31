import type {
  AdminOrderDetail,
  AdminProductDetail,
  AuditLogEntry,
  CouponView,
  OrderDetail,
  PaymentProvider,
  ReportJob,
  PublicUser,
  StockMovementView,
  StoreSettings,
} from "@hp/contracts";

// Shapes of the in-memory mock database. Every field is readonly: handlers
// build a new MockDb for each change instead of mutating the current one.

export type MockUser = Readonly<{
  user: PublicUser;
  disabled: boolean;
  twoFactorEnabled: boolean;
  /** MOCK ONLY plain-text password; null until the account's invite is accepted. */
  password: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}>;

export type MockCategory = Readonly<{
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  position: number;
}>;

export type MockOrder = Readonly<{
  order: OrderDetail;
  customerId: string | null;
  /** The card provider's payment id; null for bank transfers and unpaid orders. */
  paymentIntentId: string | null;
  paymentProvider: PaymentProvider | null;
  transferBankReference: string | null;
  transferConfirmedByEmail: string | null;
  /** Idempotency-Key of the confirm-transfer call that paid the order, for replays. */
  transferConfirmKey: string | null;
  refunds: AdminOrderDetail["refunds"];
}>;

/** An unused staff password-reset link (admin /reset-password#token=…). */
export type MockResetToken = Readonly<{ token: string; userId: string }>;

export type MockMovement = Readonly<StockMovementView & { variantId: string }>;

export type MockChallenge = Readonly<{ token: string; userId: string; enrolling: boolean }>;

export type MockDb = Readonly<{
  users: readonly MockUser[];
  invites: readonly Readonly<{ token: string; userId: string }>[];
  resetTokens: readonly MockResetToken[];
  challenges: readonly MockChallenge[];
  /** Stands in for the httpOnly refresh cookie. */
  refreshUserId: string | null;
  categories: readonly MockCategory[];
  products: readonly AdminProductDetail[];
  orders: readonly MockOrder[];
  movements: readonly MockMovement[];
  coupons: readonly CouponView[];
  audit: readonly AuditLogEntry[];
  reports: readonly ReportJob[];
  settings: StoreSettings;
}>;
