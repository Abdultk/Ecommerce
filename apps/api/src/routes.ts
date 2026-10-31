import { Router } from "express";
import type { Redis } from "ioredis";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import type { Mailer } from "./lib/mailer";
import type { PaymentGateway } from "./lib/payments";
import { prisma } from "./lib/prisma";
import type { ReportQueue } from "./lib/report-queue";
import { isLocalReportStorage, type ReportStorage } from "./lib/report-storage";
import type { ImageStorage } from "./lib/storage";
import { adminRouter } from "./modules/admin/admin.routes";
import { adminAuthRouter } from "./modules/auth/admin-auth.routes";
import { accountRouter } from "./modules/account/account.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { cartRouter } from "./modules/cart/cart.routes";
import { catalogRouter } from "./modules/catalog/catalog.routes";
import type { CheckoutCaps } from "./modules/checkout/checkout-guards";
import { checkoutRouter } from "./modules/checkout/checkout.routes";
import { ordersRouter } from "./modules/orders/orders.routes";
import { reviewsRouter } from "./modules/reviews/reviews.routes";
import { healthRouter } from "./modules/health/health.routes";
import { reportFilesRouter } from "./modules/reports/report-files.routes";
import { storeRouter } from "./modules/settings/store.routes";

export type RouteDeps = {
  mailer: Mailer;
  payments: PaymentGateway;
  storage: ImageStorage;
  redis: Redis | null;
  checkoutCaps: CheckoutCaps;
  reports: { storage: ReportStorage; queue: ReportQueue };
  limiters: {
    login: RateLimiterAbstract;
    loginPerAccount: RateLimiterAbstract;
    adminLogin: RateLimiterAbstract;
    passwordReset: RateLimiterAbstract;
    admin2fa: RateLimiterAbstract;
    admin2faPerUser: RateLimiterAbstract;
    checkout: RateLimiterAbstract;
    coupon: RateLimiterAbstract;
    orderLookup: RateLimiterAbstract;
    reportCreate: RateLimiterAbstract;
    checkoutStatus: RateLimiterAbstract;
    adminPasswordReset: RateLimiterAbstract;
  };
};

/** Everything under /api/v1. */
export function apiRouter(deps: RouteDeps): Router {
  const { mailer, payments, storage, redis, limiters } = deps;
  const orderDeps = { db: prisma, payments, mailer };
  const api = Router();
  api.use("/health", healthRouter(redis));
  api.use(
    "/auth",
    authRouter({
      mailer,
      loginLimiter: limiters.login,
      accountLimiter: limiters.loginPerAccount,
      resetLimiter: limiters.passwordReset,
    }),
  );
  api.use("/me", accountRouter({ limiter: limiters.loginPerAccount }));
  api.use("/store", storeRouter(payments));
  api.use("/products/:slug/reviews", reviewsRouter());
  api.use("/", catalogRouter());
  api.use("/cart", cartRouter({ couponLimiter: limiters.coupon }));
  api.use(
    "/checkout",
    checkoutRouter({
      ...orderDeps,
      caps: deps.checkoutCaps,
      checkoutLimiter: limiters.checkout,
      statusLimiter: limiters.checkoutStatus,
    }),
  );
  api.use("/orders", ordersRouter({ ...orderDeps, lookupLimiter: limiters.orderLookup }));
  // /admin/auth must be mounted before the guarded /admin router.
  api.use(
    "/admin/auth",
    adminAuthRouter({
      loginLimiter: limiters.adminLogin,
      accountLimiter: limiters.loginPerAccount,
      twoFactorLimiter: limiters.admin2fa,
      twoFactorUserLimiter: limiters.admin2faPerUser,
      inviteLimiter: limiters.passwordReset,
    }),
  );
  // Fake report storage serves files itself behind signed links; R2 links go straight to R2.
  if (isLocalReportStorage(deps.reports.storage)) {
    api.use("/report-files", reportFilesRouter(deps.reports.storage));
  }
  api.use(
    "/admin",
    adminRouter({
      ...orderDeps,
      storage,
      reports: { ...deps.reports, createLimiter: limiters.reportCreate },
      limiters: { stepUp: limiters.admin2faPerUser, passwordReset: limiters.adminPasswordReset },
    }),
  );
  return api;
}
