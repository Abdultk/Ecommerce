import type { OrderStatus, PaymentMethod, ProductStatus, Role } from "@hp/contracts";

// Money is formatted with formatMoney from @hp/contracts (currency-aware); money inputs are
// parsed by src/lib/money.ts.
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const count = new Intl.NumberFormat("en-US");

export function formatDate(iso: string): string {
  return shortDate.format(new Date(iso));
}

export function formatCount(n: number): string {
  return count.format(n);
}

const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: "Customer",
  STAFF: "Staff",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super admin",
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** "12" → 12, blank → null, junk → NaN (rejected by the schemas with a field error). */
export function toInt(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pending payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Card",
  bank_transfer: "Bank transfer",
  manual: "Manual payment",
};

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method];
}

const STATUS_LABELS: Record<ProductStatus, string> = {
  ACTIVE: "Active",
  DRAFT: "Draft",
  ARCHIVED: "Archived",
};

export function statusLabel(status: ProductStatus): string {
  return STATUS_LABELS[status];
}
