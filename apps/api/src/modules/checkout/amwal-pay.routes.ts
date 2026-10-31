import { randomBytes } from "node:crypto";
import { Router } from "express";
import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import type { AmwalGateway } from "../../lib/payments";
import type { OrderDeps } from "../orders/orders.service";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** JSON that is safe inside an inline <script>. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.7rem 1.2rem}</style></head><body>${body}</body></html>`;

/**
 * Hands the shopper to Amwal Pay's SmartBox. The checkout response links here (a link we
 * signed, holding only the order number); the amount and return address are read from the
 * order itself, and the secure hash is computed here so the secure key never reaches a
 * browser. The page is only for orders still waiting for payment.
 */
export function amwalPayRouter(deps: OrderDeps & { payments: AmwalGateway }): Router {
  const router = Router();

  router.get("/amwal-pay/:token", async (req, res) => {
    let number: string;
    try {
      number = deps.payments.orderInLink(req.params.token);
    } catch {
      throw new AppError("NOT_FOUND", "This payment link is not valid. Start the payment again.");
    }
    const order = await deps.db.order.findUnique({ where: { number } });
    if (!order || order.status !== "PENDING_PAYMENT") {
      throw new AppError("NOT_FOUND", "This order is not waiting for payment.");
    }
    const returnUrl = `${env.WEB_ORIGIN}/checkout/return?number=${encodeURIComponent(order.number)}`;
    const { scriptUrl, config } = deps.payments.launch({
      number: order.number,
      amountCents: order.totalCents,
      returnUrl,
    });
    const nonce = randomBytes(16).toString("base64");
    // SmartBox opens bank pages (3-D Secure) and loads its own assets, so https is allowed
    // for those; scripts stay limited to this page's nonce and what it loads.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' 'strict-dynamic'`,
        "style-src 'unsafe-inline' https:",
        "img-src https: data:",
        "font-src https:",
        "connect-src https:",
        "frame-src https:",
        `form-action https: ${env.WEB_ORIGIN}`,
        "base-uri 'none'",
      ].join("; "),
    );
    res.setHeader("Cache-Control", "no-store");
    const start = `SmartBox.Checkout.configure=${scriptJson(config)};var go=function(){SmartBox.Checkout.showSmartBox()};document.getElementById("pay").onclick=go;go();`;
    const script = `<script nonce="${nonce}" src="${escapeHtml(scriptUrl)}"></script><script nonce="${nonce}">window.addEventListener("load",function(){${start}})</script>`;
    res
      .type("html")
      .send(
        page(
          "Pay for your order",
          `<h1>Pay for order ${escapeHtml(order.number)}</h1><p>Opening the secure payment page. If nothing happens, press the button.</p><button id="pay" type="button">Pay now</button>${script}`,
        ),
      );
  });

  return router;
}
