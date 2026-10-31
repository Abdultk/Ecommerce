import { Router } from "express";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import { authenticate, requireAdmin } from "../../middleware/authenticate";
import type { ImageStorage } from "../../lib/storage";
import { reportsAdminRouter, type ReportsDeps } from "../reports/reports.admin";
import type { OrderDeps } from "../orders/orders.service";
import { settingsAdminRouter } from "../settings/settings.admin";
import { passwordResetAdminRouter } from "./password-reset.admin";
import { profileAdminRouter } from "./profile.admin";
import { analyticsAdminRouter } from "./analytics/analytics.admin";
import { couponsAdminRouter } from "./coupons.admin";
import { inventoryAdminRouter } from "./inventory.admin";
import { ordersAdminRouter } from "./orders.admin";
import { categoriesAdminRouter, productsAdminRouter } from "./products.admin";
import { auditLogRouter, usersAdminRouter } from "./users.admin";

/**
 * Everything under /admin (except /admin/auth) passes authenticate + requireAdmin; each
 * route then checks its own permission, and every change writes an audit-log entry.
 */
export function adminRouter(
  deps: OrderDeps & {
    storage: ImageStorage;
    reports: ReportsDeps;
    limiters: {
      /** Per admin: shares the TOTP guess budget with sign-in. */
      stepUp: RateLimiterAbstract;
      /** Per admin: password-reset emails sent to other users. */
      passwordReset: RateLimiterAbstract;
    };
  },
): Router {
  const router = Router();
  router.use(authenticate, requireAdmin, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.use("/me", profileAdminRouter({ stepUpLimiter: deps.limiters.stepUp }));
  router.use("/settings", settingsAdminRouter({ stepUpLimiter: deps.limiters.stepUp }));
  router.use("/", productsAdminRouter(deps.storage));
  router.use("/categories", categoriesAdminRouter());
  router.use("/orders", ordersAdminRouter(deps));
  router.use("/inventory", inventoryAdminRouter());
  router.use("/coupons", couponsAdminRouter());
  router.use(
    "/users",
    passwordResetAdminRouter({ mailer: deps.mailer, limiter: deps.limiters.passwordReset }),
  );
  router.use("/users", usersAdminRouter(deps.mailer));
  router.use("/audit-log", auditLogRouter());
  router.use("/analytics", analyticsAdminRouter());
  router.use("/reports", reportsAdminRouter(deps.reports));
  return router;
}
