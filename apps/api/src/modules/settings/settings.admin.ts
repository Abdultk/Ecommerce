import { Router, type Request } from "express";
import { Prisma, type StoreSettings as SettingsRow } from "@prisma/client";
import type { RateLimiterAbstract } from "rate-limiter-flexible";
import {
  CurrencyChangeInput,
  PaymentSettings,
  SettingsGeneralPatch,
  SettingsPaymentsPatch,
  SettingsShippingPatch,
  ok,
  type StoreSettings,
} from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { prisma, type DbClient } from "../../lib/prisma";
import { revalidateSite } from "../../lib/revalidate";
import { requirePermission } from "../../middleware/authenticate";
import { audit } from "../admin/audit";
import { verifyStepUp } from "../auth/step-up";
import { switchCurrency } from "./currency";
import {
  SETTINGS_ID,
  auditSnapshot,
  loadSettings,
  lockSettings,
  toStoreSettings,
} from "./settings.service";

type SettingsChange = (tx: DbClient, before: SettingsRow) => Promise<void>;

/**
 * Applies one settings change under the row lock and writes the audit entry (bank numbers
 * masked) in the same transaction. Returns the updated settings.
 */
async function changeSettings(
  req: Request,
  action: string,
  change: SettingsChange,
): Promise<StoreSettings> {
  return prisma.$transaction(async (tx) => {
    const before = await lockSettings(tx, "update");
    await change(tx, before);
    const after = toStoreSettings(
      await tx.storeSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } }),
    );
    await audit(tx, req, {
      action,
      entity: "StoreSettings",
      entityId: SETTINGS_ID,
      before: auditSnapshot(toStoreSettings(before)),
      after: auditSnapshot(after),
    });
    return after;
  });
}

const update = (tx: DbClient, data: Prisma.StoreSettingsUpdateInput) =>
  tx.storeSettings.update({ where: { id: SETTINGS_ID }, data });

function shippingData(patch: SettingsShippingPatch): Prisma.StoreSettingsUpdateInput {
  return {
    standardCents: patch.standardCents,
    expressCents: patch.expressCents,
    freeShippingThresholdCents: patch.freeShippingThresholdCents,
    ...(patch.standardDays && {
      standardDaysMin: patch.standardDays.min,
      standardDaysMax: patch.standardDays.max,
    }),
    ...(patch.expressDays && {
      expressDaysMin: patch.expressDays.min,
      expressDaysMax: patch.expressDays.max,
    }),
  };
}

/** Re-checks the payment rules against the merged result (a patch only sees its own fields). */
function mergedPayments(before: SettingsRow, patch: SettingsPaymentsPatch) {
  const current = toStoreSettings(before).payments;
  const { totpCode: _code, ...changes } = patch;
  const merged = PaymentSettings.safeParse({
    ...current,
    ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
  });
  if (!merged.success) {
    throw new AppError("VALIDATION_ERROR", merged.error.issues[0]?.message ?? "Invalid settings.");
  }
  return merged.data;
}

/** /admin/settings */
export function settingsAdminRouter(deps: { stepUpLimiter: RateLimiterAbstract }): Router {
  const router = Router();
  const write = requirePermission("settings:write");

  router.get("/", requirePermission("settings:read"), async (_req, res) => {
    res.json(ok(toStoreSettings(await loadSettings(prisma))));
  });

  router.patch("/general", write, async (req, res) => {
    const patch = SettingsGeneralPatch.parse(req.body);
    const settings = await changeSettings(req, "settings.general", async (tx) => {
      await update(tx, patch);
    });
    void revalidateSite("settings");
    res.json(ok(settings));
  });

  router.patch("/shipping", write, async (req, res) => {
    const patch = SettingsShippingPatch.parse(req.body);
    const settings = await changeSettings(req, "settings.shipping", async (tx) => {
      await update(tx, shippingData(patch));
    });
    void revalidateSite("settings");
    res.json(ok(settings));
  });

  // Changing where customers send money needs a fresh 2FA code: a stolen session alone
  // must not be able to redirect payments.
  router.patch("/payments", write, async (req, res) => {
    const patch = SettingsPaymentsPatch.parse(req.body);
    if (patch.bank !== undefined || patch.manualMethods !== undefined) {
      await verifyStepUp(prisma, req.user!.sub, patch.totpCode!, deps.stepUpLimiter);
    }
    const settings = await changeSettings(req, "settings.payments", async (tx, before) => {
      const merged = mergedPayments(before, patch);
      await update(tx, {
        cardEnabled: merged.cardEnabled,
        bankTransferEnabled: merged.bankTransferEnabled,
        bankTransferHoldHours: merged.bankTransferHoldHours,
        ...(patch.manualMethods !== undefined && { manualMethods: merged.manualMethods }),
        ...(patch.bank !== undefined && { bank: merged.bank ?? Prisma.JsonNull }),
      });
    });
    void revalidateSite("settings");
    res.json(ok(settings));
  });

  router.put("/currency", write, async (req, res) => {
    const input = CurrencyChangeInput.parse(req.body);
    await verifyStepUp(prisma, req.user!.sub, input.totpCode, deps.stepUpLimiter);
    const settings = await changeSettings(req, "settings.currency", (tx, before) =>
      switchCurrency(tx, before, input.currency),
    );
    void revalidateSite("settings");
    res.json(ok(settings));
  });

  return router;
}
