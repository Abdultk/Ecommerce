import { readFileSync } from "node:fs";
import { request, type APIRequestContext } from "@playwright/test";
import { SUPER_ADMIN_FILE, urls } from "./config";
import { ADDRESS, randomPassword, uniqueEmail, uniqueSuffix } from "./data";
import { linkTo, waitForEmail } from "./mailpit";
import { clientIpHeaders } from "./net";
import { secretFromOtpauthUrl, totpCode } from "./totp";

type Envelope<T> = { success: boolean; data: T; error: { code: string; message: string } | null };
export type ApiResult<T> = { status: number; body: Envelope<T> };

export type StaffRole = "STAFF" | "ADMIN" | "SUPER_ADMIN";

/** An enrolled admin: password + TOTP secret, and the step of the last code spent. */
export type AdminAccount = {
  email: string;
  password: string;
  role: StaffRole;
  secret: string;
  lastStep: number;
  accessToken: string;
};

/** Thin JSON client for the E2E API. Every context presents its own client IP. */
export class Api {
  private constructor(private readonly ctx: APIRequestContext) {}

  static async create(): Promise<Api> {
    const ctx = await request.newContext({ extraHTTPHeaders: clientIpHeaders() });
    return new Api(ctx);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  async call<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; token?: string } = {},
  ): Promise<ApiResult<T>> {
    const res = await this.ctx.fetch(`${urls.api}${path}`, {
      method,
      data: options.body,
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
    });
    return { status: res.status(), body: (await res.json()) as Envelope<T> };
  }

  /** Like call() but throws unless the response is 2xx. */
  async ok<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; token?: string } = {},
  ): Promise<T> {
    const { status, body } = await this.call<T>(method, path, options);
    if (status >= 300 || !body.success) {
      throw new Error(`${method} ${path} → ${status}: ${JSON.stringify(body.error)}`);
    }
    return body.data;
  }
}

// ---------- Admins ----------

export function superAdmin(): AdminAccount {
  try {
    return JSON.parse(readFileSync(SUPER_ADMIN_FILE, "utf8")) as AdminAccount;
  } catch {
    throw new Error(`${SUPER_ADMIN_FILE} is missing; run the "setup" project first.`);
  }
}

/** Invites a staff member as the super admin and returns the emailed invite link. */
export async function inviteStaff(
  api: Api,
  role: StaffRole,
): Promise<{ email: string; inviteLink: string }> {
  const email = uniqueEmail(role.toLowerCase());
  await api.ok("POST", "/admin/users/invite", {
    token: superAdmin().accessToken,
    body: { email, firstName: "Eve", lastName: `Tester ${role}`, role },
  });
  const mail = await waitForEmail(email, /invited to the PAISLEY art admin/);
  return { email, inviteLink: linkTo(mail, urls.admin) };
}

export const inviteTokenFrom = (link: string): string => {
  const token = new URLSearchParams(new URL(link).hash.replace(/^#/, "")).get("token");
  if (!token) throw new Error(`No #token= in ${link}`);
  return token;
};

/** Redeems an invite through the API and completes TOTP enrollment with the first code. */
export async function enrollFromInvite(
  api: Api,
  email: string,
  inviteLink: string,
  role: StaffRole,
): Promise<AdminAccount> {
  const password = randomPassword();
  const challenge = await api.ok<{ challengeToken: string; otpauthUrl: string }>(
    "POST",
    "/admin/auth/accept-invite",
    { body: { token: inviteTokenFrom(inviteLink), password } },
  );
  const secret = secretFromOtpauthUrl(challenge.otpauthUrl);
  const { code, step } = totpCode(secret, null);
  const session = await api.ok<{ accessToken: string }>("POST", "/admin/auth/2fa", {
    body: { challengeToken: challenge.challengeToken, code },
  });
  return { email, password, role, secret, lastStep: step, accessToken: session.accessToken };
}

/** A fresh, fully enrolled staff account for one test. */
export async function createAdmin(api: Api, role: StaffRole): Promise<AdminAccount> {
  const { email, inviteLink } = await inviteStaff(api, role);
  return enrollFromInvite(api, email, inviteLink, role);
}

// ---------- Catalog fixtures ----------

type Category = { id: string; slug: string; name: string; children?: Category[] };

const flatten = (nodes: Category[]): Category[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);

export async function categoryBySlug(api: Api, slug = "skillets"): Promise<Category> {
  const all = flatten(await api.ok<Category[]>("GET", "/categories"));
  const found = all.find((c) => c.slug === slug) ?? all.find((c) => !c.children?.length);
  if (!found) throw new Error("No categories seeded");
  return found;
}

export type CreatedProduct = {
  id: string;
  slug: string;
  name: string;
  sku: string;
  variantId: string;
  priceCents: number;
};

/** An ACTIVE product owned by one test, so stock changes never leak between tests. */
export async function createProduct(
  api: Api,
  options: { stock: number; priceCents?: number; namePrefix?: string },
): Promise<CreatedProduct> {
  const suffix = uniqueSuffix();
  const name = `${options.namePrefix ?? "E2E Carbon Steel Pan"} ${suffix}`;
  const slug = `e2e-pan-${suffix}`;
  const sku = `E2E-${suffix.toUpperCase()}`;
  const priceCents = options.priceCents ?? 5_900;
  const category = await categoryBySlug(api);
  const product = await api.ok<{ id: string; variants: { id: string; sku: string }[] }>(
    "POST",
    "/admin/products",
    {
      token: superAdmin().accessToken,
      body: {
        name,
        slug,
        categoryId: category.id,
        description: "<p>Made for end-to-end tests.</p>",
        material: "Carbon steel",
        status: "ACTIVE",
        variants: [{ sku, name: "10 inch", priceCents, initialStock: options.stock }],
      },
    },
  );
  const variant = product.variants.find((v) => v.sku === sku) ?? product.variants[0];
  if (!variant) throw new Error("Created product has no variant");
  return { id: product.id, slug, name, sku, variantId: variant.id, priceCents };
}

// ---------- Orders ----------

export type AdminOrder = {
  id: string;
  number: string;
  status: string;
  trackingNumber?: string | null;
};

export async function adminOrderByNumber(api: Api, number: string): Promise<AdminOrder> {
  const rows = await api.ok<AdminOrder[]>("GET", `/admin/orders?q=${encodeURIComponent(number)}`, {
    token: superAdmin().accessToken,
  });
  const order = rows.find((o) => o.number === number);
  if (!order) throw new Error(`Order ${number} not found in /admin/orders`);
  return order;
}

export const adminOrder = (api: Api, id: string) =>
  api.ok<{ order: AdminOrder } & Record<string, unknown>>("GET", `/admin/orders/${id}`, {
    token: superAdmin().accessToken,
  });

// ---------- Customers ----------

export type Customer = { email: string; password: string; accessToken: string };

/** Registers a customer through the API (the UI path is covered by auth.spec.ts). */
export async function registerCustomer(api: Api, tag = "customer"): Promise<Customer> {
  const email = uniqueEmail(tag);
  const password = randomPassword();
  await api.ok("POST", "/auth/register", {
    body: { email, password, firstName: "Ada", lastName: "Cook" },
  });
  // Registering signs nobody in: confirm the address from the email, then sign in.
  const link = linkTo(await waitForEmail(email, /Confirm your email/), urls.web);
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  await api.ok("POST", "/auth/verify-email", { body: { token } });
  const session = await api.ok<{ accessToken: string }>("POST", "/auth/login", {
    body: { email, password },
  });
  return { email, password, accessToken: session.accessToken };
}

/** A PAID order for `customer`, placed and paid through the public API (fake provider). */
export async function placePaidOrder(
  api: Api,
  customer: Customer,
  variantId: string,
): Promise<{ number: string; id: string }> {
  const token = customer.accessToken;
  await api.ok("POST", "/cart/items", { token, body: { variantId, quantity: 1 } });
  const intent = await api.ok<{ orderNumber: string }>("POST", "/checkout/intent", {
    token,
    body: { email: customer.email, shippingAddress: ADDRESS, shippingMethod: "standard", paymentMethod: "card" },
  });
  await api.ok("POST", "/checkout/fake-confirm", { body: { orderNumber: intent.orderNumber } });
  const order = await adminOrderByNumber(api, intent.orderNumber);
  return { number: intent.orderNumber, id: order.id };
}
