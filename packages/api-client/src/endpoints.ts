import { z } from "zod";
import {
  AdminOrderDetail,
  AdminProfile,
  CheckoutStatus,
  PasswordResetSent,
  PublicStoreConfig,
  StoreSettings,
  type AdminPasswordResetInput,
  type AdminResetPasswordInput,
  type ChangePasswordInput,
  type CheckoutStatusInput,
  type ConfirmTransferInput,
  type CurrencyChangeInput,
  type ProfileUpdate,
  type SettingsGeneralPatch,
  type SettingsPaymentsPatch,
  type SettingsShippingPatch,
} from "@hp/contracts";
import type { ApiClient } from "./index";

// Bodies are typed with z.input: callers send raw form values; the API parses them.
type In<T extends z.ZodTypeAny> = z.input<T>;

const NoContent = z.null();
const segment = (id: string) => encodeURIComponent(id);

/**
 * Typed calls for the Phase 3b endpoints (store settings, admin account, payments).
 * Thin wrappers over the generic client: same envelope handling, errors and refresh.
 */
export function createEndpoints(api: ApiClient) {
  return {
    store: {
      get: () => api.get("/store", PublicStoreConfig),
    },
    checkout: {
      /** Polled by /checkout/return; the server confirms with the provider first. */
      status: (body: In<typeof CheckoutStatusInput>) =>
        api.post("/checkout/status", body, CheckoutStatus),
    },
    adminSettings: {
      get: () => api.get("/admin/settings", StoreSettings),
      patchGeneral: (body: In<typeof SettingsGeneralPatch>) =>
        api.patch("/admin/settings/general", body, StoreSettings),
      patchShipping: (body: In<typeof SettingsShippingPatch>) =>
        api.patch("/admin/settings/shipping", body, StoreSettings),
      patchPayments: (body: In<typeof SettingsPaymentsPatch>) =>
        api.patch("/admin/settings/payments", body, StoreSettings),
      /** 409 CURRENCY_LOCKED once any order exists. */
      changeCurrency: (body: In<typeof CurrencyChangeInput>) =>
        api.put("/admin/settings/currency", body, StoreSettings),
    },
    adminUsers: {
      sendPasswordReset: (userId: string, body: In<typeof AdminPasswordResetInput> = {}) =>
        api.post(`/admin/users/${segment(userId)}/password-reset`, body, PasswordResetSent),
    },
    adminAuth: {
      resetPassword: (body: In<typeof AdminResetPasswordInput>) =>
        api.post("/admin/auth/reset-password", body, NoContent),
    },
    adminMe: {
      get: () => api.get("/admin/me", AdminProfile),
      update: (body: In<typeof ProfileUpdate>) => api.patch("/admin/me", body, AdminProfile),
      changePassword: (body: In<typeof ChangePasswordInput>) =>
        api.post("/admin/me/password", body, NoContent),
      revokeOtherSessions: () => api.post("/admin/me/sessions/revoke-others", {}, NoContent),
    },
    adminOrders: {
      /** Idempotency-Key is required by the API; reuse it when retrying the same confirmation. */
      confirmTransfer: (
        orderId: string,
        body: In<typeof ConfirmTransferInput>,
        idempotencyKey: string,
      ) =>
        api.post(`/admin/orders/${segment(orderId)}/confirm-transfer`, body, AdminOrderDetail, {
          "Idempotency-Key": idempotencyKey,
        }),
    },
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
