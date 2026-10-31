// TanStack Query keys shared by screens that read or invalidate the same data.

export const PRODUCTS_KEY = ["admin-products"] as const;
export const productKey = (id: string) => ["admin-product", id] as const;
export const ORDERS_KEY = ["admin-orders"] as const;
export const orderKey = (id: string) => ["admin-order", id] as const;
export const INVENTORY_KEY = ["admin-inventory"] as const;
export const MOVEMENTS_KEY = ["admin-movements"] as const;
export const COUPONS_KEY = ["admin-coupons"] as const;
export const USERS_KEY = ["admin-users"] as const;
export const AUDIT_KEY = ["admin-audit"] as const;
export const ANALYTICS_KEY = ["admin-analytics"] as const;
export const REPORTS_KEY = ["admin-reports"] as const;
export const reportJobKey = (id: string) => [...REPORTS_KEY, "job", id] as const;
export const SETTINGS_KEY = ["admin-settings"] as const;
export const STORE_CONFIG_KEY = ["store-config"] as const;
export const PROFILE_KEY = ["admin-profile"] as const;
