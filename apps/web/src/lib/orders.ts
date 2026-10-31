"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { OrderDetail, OrderSummary, type OrderStatus, type PaymentMethod } from "@hp/contracts";
import { ApiClientError } from "@hp/api-client";
import { browserApi } from "./api";
import { useAuth } from "./use-auth";

const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PROCESSING: "Being packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** A transfer order waiting for money says so; everything else uses the plain label. */
export const orderStatusLabel = (status: OrderStatus, paymentMethod?: PaymentMethod): string =>
  status === "PENDING_PAYMENT" && paymentMethod === "bank_transfer"
    ? "Awaiting bank transfer"
    : STATUS_LABELS[status];

const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  card: "Card",
  bank_transfer: "Bank transfer",
  manual: "Manual payment",
};

export const paymentMethodLabel = (method: PaymentMethod): string => PAYMENT_METHOD_LABELS[method];

/** Customers may cancel only before the order is packed (the API enforces the same). */
const CANCELLABLE: ReadonlySet<OrderStatus> = new Set(["PENDING_PAYMENT", "PAID"]);
export const cancellable = (status: OrderStatus): boolean => CANCELLABLE.has(status);

export const ORDERS_PAGE_SIZE = 10;
const GENERIC_ERROR = "Something went wrong. Please try again.";

export const errorMessage = (error: unknown): string =>
  error instanceof ApiClientError ? error.message : GENERIC_ERROR;

export async function fetchOwnOrder(number: string): Promise<OrderDetail> {
  return (await browserApi.get(`/orders/${encodeURIComponent(number)}`, OrderDetail)).data;
}

/** Guest lookup: the token travels in the POST body, never in a URL. */
export async function lookupGuestOrder(number: string, token: string): Promise<OrderDetail> {
  return (await browserApi.post("/orders/lookup", { number, token }, OrderDetail)).data;
}

const orderKeys = {
  list: (userId: string | undefined, page: number) => ["orders", userId, page] as const,
  detail: (userId: string | undefined, number: string) => ["order", userId, number] as const,
};

export function useOrders(page: number) {
  const { user } = useAuth();
  return useQuery({
    queryKey: orderKeys.list(user?.id, page),
    enabled: Boolean(user),
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(ORDERS_PAGE_SIZE) });
      return browserApi.get(`/orders?${qs.toString()}`, z.array(OrderSummary));
    },
  });
}

export function useOrder(number: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: orderKeys.detail(user?.id, number),
    enabled: Boolean(user),
    queryFn: () => fetchOwnOrder(number),
  });
}

export function useCancelOrder(number: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await browserApi.post(`/orders/${encodeURIComponent(number)}/cancel`, {}, OrderDetail)).data,
    onSuccess: (order) => {
      queryClient.setQueryData(orderKeys.detail(user?.id, number), order);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
