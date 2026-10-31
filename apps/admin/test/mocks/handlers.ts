import { createStore, type MockStore } from "./db";
import { createContext } from "./http";
import { accountRoutes } from "./routes/account";
import { analyticsRoutes } from "./routes/analytics";
import { authRoutes } from "./routes/auth";
import { catalogRoutes } from "./routes/catalog";
import { orderRoutes } from "./routes/orders";
import { peopleRoutes } from "./routes/people";
import { reportRoutes } from "./routes/reports";
import { settingsRoutes } from "./routes/settings";
import { stockAndCouponRoutes } from "./routes/stock-coupons";

// Contract-faithful mock of the admin API (apps/api/src/modules/admin). Each call
// to createAdminMockHandlers gets its own in-memory store, so tests never share
// state; the store is replaced on every change, never mutated.

export function createAdminMockHandlers(baseUrl: string, store: MockStore = createStore()) {
  const ctx = createContext(baseUrl, store);
  return [
    ...authRoutes(ctx),
    ...accountRoutes(ctx),
    ...settingsRoutes(ctx),
    ...catalogRoutes(ctx),
    ...orderRoutes(ctx),
    ...stockAndCouponRoutes(ctx),
    ...peopleRoutes(ctx),
    ...analyticsRoutes(ctx),
    ...reportRoutes(ctx),
  ];
}
