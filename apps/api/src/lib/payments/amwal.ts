import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  PaymentProviderError,
  WebhookSignatureError,
  type PaymentEvent,
  type PaymentGateway,
  type PaymentRef,
  type PaymentStatus,
} from "./types";

/*
 * Amwal Pay (Oman), SmartBox checkout. Endpoints, field names and the hash scheme come from
 * Amwal's developer portal (https://amwalpay.om/developers/), read 2026-10-24:
 *  - SmartBox offsite implementation: /developers/smartbox/offsite-implementation/
 *  - Secure hash calculation:         /developers/secure-hash-calculation/secure-hash-calculation-2/
 *  - Get transaction by merchant ref: /developers/webhooks/get-transaction-by-merchant-reference/
 *  - Refund payment:                  /developers/webhooks/refund-payment/
 *  - Merchant cloud notification:     /developers/merchant-cloud-notification/...
 *
 * Documented facts relied on: CurrencyId 512 = OMR with amounts as decimal OMR ("1.025");
 * every request carries a secure hash = uppercase hex HMAC-SHA256 over the non-null fields
 * sorted by name and joined `key=value&key=value`, keyed with the merchant's secure key
 * decoded from hex; the hash is computed on the server only; the transaction lookup is by
 * merchantReference (we use the order number) and returns Purchase transactions, newest
 * first, with responseCode "00" meaning approved; refunds go to POST /Execute/Refund;
 * the cloud notification is a JSON POST carrying `SecureHash`.
 *
 * NOT documented, so handled defensively (check these against UAT before going live):
 *  - Which fields the refund hash covers: we hash every body field except secureHashValue.
 *  - Refund idempotency and the meaning of the refund body's `transactionId`: we derive a
 *    stable GUID from the idempotency key so a retry repeats the same request.
 *  - Whether a failed attempt and a later success share a merchantReference: the status
 *    check looks for any approved Purchase among the matches.
 *  - Notification timestamp tolerance or event ids: a notification only triggers a
 *    server-side status check, so a replay changes nothing.
 *  - A cancel API: none exists, so an abandoned checkout simply expires with our link.
 */

export const AMWAL_HOSTS = {
  uat: {
    api: "https://test.amwalpg.com:14443",
    smartBox: "https://test.amwalpg.com:7443/js/SmartBox.js?v=1.1",
  },
  production: {
    api: "https://webhook.amwalpg.com",
    smartBox: "https://checkout.amwalpg.com/js/SmartBox.js?v=1.1",
  },
} as const;

export const AMWAL_MIN_TOTAL_BAISA = 100;
const CURRENCY_ID_OMR = 512;
const APPROVED = "00";
const BAISA_PER_OMR = 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_LINK_MINUTES = 60;

export type AmwalConfig = {
  env: keyof typeof AMWAL_HOSTS;
  merchantId: string;
  terminalId: string;
  /** Merchant secure key from Amwal, hex encoded. */
  secureKey: string;
  /** API address of the launcher page (`/api/v1/checkout/amwal-pay`), no trailing slash. */
  launcherBase: string;
  /** Signs launcher links so they can't be forged or altered. */
  linkSecret: string;
  /** How long a launcher link works. */
  linkMinutes?: number;
  /** Injected in tests (fixture responses, no network). */
  fetch?: typeof fetch;
  now?: () => Date;
};

/** What the launcher page hands to SmartBox.js. Never contains the secure key. */
export type AmwalLaunch = {
  scriptUrl: string;
  config: Record<string, string | number>;
};

export type AmwalGateway = PaymentGateway & {
  /** Verifies a launcher link and returns the order number inside it. Throws if invalid. */
  orderInLink(token: string): string;
  /** The signed SmartBox configuration for one order, using the amount held in our database. */
  launch(order: { number: string; amountCents: number; returnUrl: string }): AmwalLaunch;
};

const Envelope = z.object({
  success: z.boolean(),
  errorList: z.array(z.string()).nullish(),
  data: z.unknown().optional(),
});

const Transaction = z.object({
  id: z.string().min(1),
  amount: z.number(),
  responseCode: z.string().nullish(),
  transactionType: z.string().nullish(),
});

const RefundData = z.object({ transactionId: z.string().min(1) });

const LinkPayload = z.object({
  o: z.string().min(1), // order number = merchantReference
  x: z.number().int(), // expiry, epoch seconds
});

const Notification = z.object({
  TxnType: z.string().nullish(),
  ResponseCode: z.string().nullish(),
  SystemReference: z.string().nullish(),
  MerchantReference: z.string().nullish(),
  SecureHash: z.string().nullish(),
});

/** Fields the cloud notification hash covers, exactly as named in Amwal's documentation. */
const NOTIFICATION_HASH_FIELDS = [
  "Amount",
  "AuthorizationDateTime",
  "CurrencyId",
  "DateTimeLocalTrxn",
  "MerchantId",
  "MerchantReference",
  "Message",
  "PaidThrough",
  "ResponseCode",
  "SystemReference",
  "TerminalId",
  "TxnType",
] as const;

type HashFields = Record<string, string | number | null | undefined>;

const omr = (baisa: number) => (baisa / BAISA_PER_OMR).toFixed(3);
const toBaisa = (amount: number) => Math.round(amount * BAISA_PER_OMR);

/** Constant-time comparison of two strings. */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `key=value&key=value` over non-null fields, sorted by key (the hash input). */
export function amwalHashInput(fields: HashFields): string {
  return Object.keys(fields)
    .filter((key) => fields[key] !== null && fields[key] !== undefined)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
}

/** Uppercase hex HMAC-SHA256 of the hash input, keyed with the hex-decoded secure key. */
export function amwalSecureHash(fields: HashFields, hexKey: string): string {
  return createHmac("sha256", Buffer.from(hexKey, "hex"))
    .update(amwalHashInput(fields), "utf8")
    .digest("hex")
    .toUpperCase();
}

/** A GUID derived from a string, so the same idempotency key always yields the same id. */
function guidFrom(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The notification's Amount exactly as written (1000.0 stays "1000.0"), since it is hashed as text. */
function rawAmount(raw: string): string | null {
  return /"Amount"\s*:\s*"?([^",}\s]+)/.exec(raw)?.[1] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function compactUtc(d: Date): string {
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return `${date}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function createAmwalGateway(config: AmwalConfig): AmwalGateway {
  const hosts = AMWAL_HOSTS[config.env];
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const linkMinutes = config.linkMinutes ?? DEFAULT_LINK_MINUTES;
  const merchantId = Number(config.merchantId);
  const terminalId = Number(config.terminalId);

  const sign = (payload: string) =>
    createHmac("sha256", config.linkSecret).update(payload, "utf8").digest("base64url");

  function makeLink(orderNumber: string): string {
    const expires = Math.floor(now().getTime() / 1000) + linkMinutes * 60;
    const payload = Buffer.from(JSON.stringify({ o: orderNumber, x: expires })).toString(
      "base64url",
    );
    return `${config.launcherBase}/${payload}.${sign(payload)}`;
  }

  function orderInLink(token: string): string {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined || !sameText(signature, sign(payload))) {
      throw new PaymentProviderError("Invalid Amwal launcher link");
    }
    const parsed = LinkPayload.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (!parsed.success || parsed.data.x * 1000 < now().getTime()) {
      throw new PaymentProviderError("Expired Amwal launcher link");
    }
    return parsed.data.o;
  }

  async function call<T>(path: string, body: Record<string, string | number>, schema: z.ZodType<T>) {
    const res = await doFetch(`${hosts.api}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, secureHashValue: amwalSecureHash(body, config.secureKey) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = Envelope.safeParse(await res.json().catch(() => null));
    if (!res.ok || !parsed.success || !parsed.data.success) {
      const detail = parsed.success ? (parsed.data.errorList ?? []).join("; ") : "";
      throw new PaymentProviderError(
        `Amwal ${path} failed (HTTP ${res.status}${detail ? `: ${detail}` : ""})`,
      );
    }
    const data = schema.safeParse(parsed.data.data);
    if (!data.success) throw new PaymentProviderError(`Amwal ${path}: unexpected response`);
    return data.data;
  }

  const orderOf = (ref: PaymentRef) => {
    if (!ref.sessionId) throw new PaymentProviderError("Amwal payments need the order reference");
    return ref.sessionId;
  };

  const redirect = (orderNumber: string) => ({
    kind: "redirect" as const,
    provider: "amwal" as const,
    redirectUrl: makeLink(orderNumber),
  });

  async function statusOfOrder(orderNumber: string): Promise<PaymentStatus> {
    const found = await call(
      "/Transaction/GetByMerchantReference",
      { merchantId, merchantReference: orderNumber, requestDateTime: compactUtc(now()) },
      z.array(Transaction),
    );
    const approved = found.find(
      (t) => t.responseCode === APPROVED && (t.transactionType ?? "Purchase") === "Purchase",
    );
    if (!approved) return { status: "requires_payment", amountCents: 0, paymentId: null };
    return { status: "succeeded", amountCents: toBaisa(approved.amount), paymentId: approved.id };
  }

  return {
    provider: "amwal",
    supports: (currency, amountCents) => currency === "OMR" && amountCents >= AMWAL_MIN_TOTAL_BAISA,
    async createPayment(input) {
      if (input.currency !== "OMR") throw new PaymentProviderError("Amwal Pay only accepts OMR");
      return {
        ref: { paymentId: null, sessionId: input.orderNumber },
        payment: redirect(input.orderNumber),
      };
    },
    async resumePayment(ref) {
      return redirect(orderOf(ref));
    },
    async cancelPayment() {
      // Amwal has no cancel call; the launcher link expires and a late payment is refunded.
    },
    getPaymentStatus: (ref) => statusOfOrder(orderOf(ref)),
    async refund({ paymentId, amountCents, idempotencyKey }) {
      const refund = await call(
        "/Execute/Refund",
        {
          transactionId: guidFrom(idempotencyKey),
          transactionIdentifierValue: paymentId,
          transactionIdentifierType: 2,
          requestDateTime: now().toISOString(),
          terminalId,
          merchantId,
          currencyCode: CURRENCY_ID_OMR,
          amount: amountCents / BAISA_PER_OMR,
        },
        RefundData,
      );
      return { id: refund.transactionId };
    },
    parseWebhook(rawBody): PaymentEvent {
      const text = rawBody.toString("utf8");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new WebhookSignatureError();
      }
      const fields = (json ?? {}) as Record<string, unknown>;
      const note = Notification.parse(fields);
      if (!note.SecureHash) throw new WebhookSignatureError();
      const hashed: HashFields = {};
      for (const name of NOTIFICATION_HASH_FIELDS) {
        const value = fields[name];
        if (name === "Amount") hashed[name] = rawAmount(text);
        else if (typeof value === "string" || typeof value === "number") hashed[name] = value;
      }
      if (!sameText(note.SecureHash.toUpperCase(), amwalSecureHash(hashed, config.secureKey))) {
        throw new WebhookSignatureError();
      }
      const reference = note.MerchantReference;
      const id = `amwal:${note.SystemReference ?? reference ?? "unknown"}:${note.ResponseCode ?? ""}`;
      const isApprovedPurchase = note.TxnType === "Purchase" && note.ResponseCode === APPROVED;
      if (!isApprovedPurchase || !reference) return { id, type: "ignored" };
      return { id, type: "check_payment", ref: { paymentId: null, sessionId: reference } };
    },
    orderInLink,
    launch(order): AmwalLaunch {
      const when = now().toISOString();
      const hashed = {
        Amount: omr(order.amountCents),
        CurrencyId: CURRENCY_ID_OMR,
        MerchantId: merchantId,
        MerchantReference: order.number,
        RequestDateTime: when,
        SessionToken: "",
        TerminalId: terminalId,
      };
      return {
        scriptUrl: hosts.smartBox,
        config: {
          MID: merchantId,
          TID: terminalId,
          CurrencyId: CURRENCY_ID_OMR,
          AmountTrxn: hashed.Amount,
          MerchantReference: order.number,
          LanguageId: "en",
          PaymentViewType: 2,
          TrxDateTime: when,
          SessionToken: "",
          ReturnUrl: order.returnUrl,
          CancelUrl: `${order.returnUrl}&cancelled=1`,
          CheckoutSiteMode: "offsite",
          SecureHash: amwalSecureHash(hashed, config.secureKey),
        },
      };
    },
  };
}
