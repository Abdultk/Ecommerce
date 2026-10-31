import { Router, type Request } from "express";
import argon2 from "argon2";
import type { User } from "@prisma/client";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import {
  CustomerChangePasswordInput,
  CustomerPreferencesUpdate,
  DeleteAccountInput,
  ok,
  type AccountSession,
} from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { pathParam } from "../../lib/params";
import { prisma } from "../../lib/prisma";
import { consumeOrThrow } from "../../lib/rate-limit";
import { hashPassword } from "../auth/auth.service";
import { clearRefreshCookie, revokeFamily, revokeOtherSessions } from "../auth/session";
import { refreshRating } from "../reviews/reviews.routes";
import { PAYMENT_IN, deviceLabel, toPreferences } from "./preferences";

const WRONG_PASSWORD = "Your password is incorrect.";

async function currentUser(req: Request): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user || user.disabledAt) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  return user;
}

/** A wrong guess counts against the per-account budget shared with sign-in. */
async function checkPassword(user: User, password: string, limiter: RateLimiterAbstract) {
  await consumeOrThrow(limiter, `account:${user.id}`);
  if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) {
    throw new AppError("VALIDATION_ERROR", WRONG_PASSWORD);
  }
}

/**
 * The customer's own settings, mounted inside /me (so already authenticated): preferences,
 * password, signed-in devices, a copy of their data, and deleting the account.
 */
export function accountSettingsRouter(deps: { limiter: RateLimiterAbstract }): Router {
  const router = Router();

  // ---------- Preferences ----------

  router.get("/preferences", async (req, res) => {
    const row = await prisma.customerPreferences.findUnique({ where: { userId: req.user!.sub } });
    res.json(ok(toPreferences(row)));
  });

  router.put("/preferences", async (req, res) => {
    const input = CustomerPreferencesUpdate.parse(req.body);
    const userId = req.user!.sub;
    const data = {
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.marketingEmails !== undefined && { marketingEmails: input.marketingEmails }),
      ...(input.shippingUpdateEmails !== undefined && {
        shippingUpdateEmails: input.shippingUpdateEmails,
      }),
      ...(input.preferredPayment !== undefined && {
        preferredPayment:
          input.preferredPayment === null ? null : PAYMENT_IN[input.preferredPayment],
      }),
      ...(input.preferredShipping !== undefined && { preferredShipping: input.preferredShipping }),
    };
    const row = await prisma.customerPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    res.json(ok(toPreferences(row)));
  });

  // ---------- Password and devices ----------

  router.post("/password", async (req, res) => {
    const input = CustomerChangePasswordInput.parse(req.body);
    const user = await currentUser(req);
    await checkPassword(user, input.currentPassword, deps.limiter);
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await revokeOtherSessions(tx, user.id, req.user!.fam);
    });
    res.json(ok(null));
  });

  router.get("/sessions", async (req, res) => {
    const now = new Date();
    const userId = req.user!.sub;
    const live = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now }, familyExpiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    const latest = new Map<string, (typeof live)[number]>();
    for (const row of live) if (!latest.has(row.familyId)) latest.set(row.familyId, row);
    const started = await prisma.refreshToken.groupBy({
      by: ["familyId"],
      where: { userId, familyId: { in: [...latest.keys()] } },
      _min: { createdAt: true },
    });
    const startedAt = new Map(started.map((s) => [s.familyId, s._min.createdAt]));
    const sessions: AccountSession[] = [...latest.values()]
      .map((row) => ({
        id: row.familyId,
        device: deviceLabel(row.userAgent),
        signedInAt: (startedAt.get(row.familyId) ?? row.createdAt).toISOString(),
        expiresAt: row.familyExpiresAt.toISOString(),
        current: row.familyId === req.user!.fam,
      }))
      .sort(
        (a, b) => Number(b.current) - Number(a.current) || b.signedInAt.localeCompare(a.signedInAt),
      );
    res.json(ok(sessions));
  });

  router.delete("/sessions/:id", async (req, res) => {
    const familyId = pathParam(req, "id");
    if (familyId === req.user!.fam) {
      throw new AppError(
        "CONFLICT",
        "That's the device you're using. Sign out from the menu instead.",
      );
    }
    const owned = await prisma.refreshToken.findFirst({
      where: { familyId, userId: req.user!.sub },
      select: { id: true },
    });
    if (!owned) throw new AppError("NOT_FOUND", "Device not found.");
    await revokeFamily(prisma, familyId);
    res.json(ok(null));
  });

  router.post("/sessions/revoke-others", async (req, res) => {
    await revokeOtherSessions(prisma, req.user!.sub, req.user!.fam);
    res.json(ok(null));
  });

  // ---------- Privacy ----------

  router.get("/export", async (req, res) => {
    const userId = req.user!.sub;
    const user = await currentUser(req);
    const [preferences, addresses, wishlist, orders, reviews] = await Promise.all([
      prisma.customerPreferences.findUnique({ where: { userId } }),
      prisma.address.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      prisma.wishlistItem.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        include: { items: true },
      }),
      prisma.review.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    ]);
    res.json(
      ok({
        exportedAt: new Date().toISOString(),
        account: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt.toISOString(),
          emailVerified: user.emailVerifiedAt !== null,
        },
        preferences: toPreferences(preferences),
        addresses: addresses.map((a) => ({
          fullName: a.fullName,
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          region: a.region,
          postalCode: a.postalCode,
          country: a.country,
          phone: a.phone,
          isDefault: a.isDefault,
        })),
        wishlist: wishlist.map((w) => ({
          productId: w.productId,
          addedAt: w.createdAt.toISOString(),
        })),
        orders: orders.map((o) => ({
          number: o.number,
          placedAt: o.createdAt.toISOString(),
          status: o.status,
          currency: o.currency,
          paymentMethod: o.paymentMethod,
          subtotalCents: o.subtotalCents,
          discountCents: o.discountCents,
          shippingCents: o.shippingCents,
          taxCents: o.taxCents,
          totalCents: o.totalCents,
          items: o.items.map((i) => ({
            product: i.productName,
            variant: i.variantName,
            sku: i.sku,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
          })),
        })),
        reviews: reviews.map((r) => ({
          productId: r.productId,
          rating: r.rating,
          title: r.title,
          body: r.body,
          postedAt: r.createdAt.toISOString(),
        })),
      }),
    );
  });

  /**
   * Deletes the account and what hangs off it (addresses, wishlist, cart, devices, settings,
   * reviews). Orders stay for fulfilment and accounting, but no longer point at the person.
   */
  router.post("/delete", async (req, res) => {
    const input = DeleteAccountInput.parse(req.body);
    const user = await currentUser(req);
    if (user.role !== "CUSTOMER") {
      throw new AppError("FORBIDDEN", "Staff accounts are managed by a super admin.");
    }
    await checkPassword(user, input.password, deps.limiter);
    await prisma.$transaction(async (tx) => {
      const reviewed = await tx.review.findMany({
        where: { userId: user.id },
        select: { productId: true },
      });
      await tx.review.deleteMany({ where: { userId: user.id } });
      for (const productId of new Set(reviewed.map((r) => r.productId))) {
        await refreshRating(tx, productId);
      }
      await tx.user.delete({ where: { id: user.id } });
    });
    clearRefreshCookie(res, "customer");
    res.json(ok(null));
  });

  return router;
}
