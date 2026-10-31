import { Router } from "express";
import { ok } from "@hp/contracts";
import type { PaymentGateway } from "../../lib/payments";
import { prisma } from "../../lib/prisma";
import { loadSettings, toPublicConfig } from "./settings.service";

const PUBLIC_MAX_AGE_SECONDS = 60;

/** GET /store: what the storefront needs to render prices and the payment step. */
export function storeRouter(payments: PaymentGateway): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    const config = toPublicConfig(await loadSettings(prisma), payments);
    res.setHeader("Cache-Control", `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`);
    res.json(ok(config));
  });
  return router;
}
