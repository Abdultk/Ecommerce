import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  amwalHashInput,
  amwalSecureHash,
  createAmwalGateway,
  type AmwalConfig,
  type AmwalGateway,
} from "./amwal";
import { PaymentProviderError, WebhookSignatureError } from "./types";

const KEY = "9FFA1F36D6E8A136482DF921E856709226DE5A974DB2673F84DB79DA788F7E19";
const NOW = new Date("2026-10-24T10:21:09.735Z");
const LAUNCHER = "https://api.example.com/api/v1/checkout/amwal-pay";

type Call = { url: string; body: Record<string, unknown> };

function setup(reply: unknown = { success: true, data: [] }, status = 200) {
  const calls: Call[] = [];
  const fetchFixture = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  const config: AmwalConfig = {
    env: "uat",
    merchantId: "48804",
    terminalId: "113176",
    secureKey: KEY,
    launcherBase: LAUNCHER,
    linkSecret: "x".repeat(32),
    fetch: fetchFixture,
    now: () => NOW,
  };
  return { gateway: createAmwalGateway(config), calls, config };
}

const expectedHash = (data: string) =>
  createHmac("sha256", Buffer.from(KEY, "hex")).update(data).digest("hex").toUpperCase();

const paymentInput = {
  amountCents: 12_500,
  currency: "OMR" as const,
  orderId: "o1",
  orderNumber: "HP-1001",
  email: "a@b.co",
  customerName: "A B",
  phone: null,
  returnUrl: "https://shop.example/checkout/return?number=HP-1001",
  idempotencyKey: "intent:o1",
};

/** A cloud notification signed the way Amwal documents it (Amount hashed as written). */
function notification(overrides: Record<string, unknown> = {}, amountText = "1.5") {
  const fields: Record<string, string | number> = {
    AuthorizationDateTime: "20261024102109",
    CurrencyId: 512,
    DateTimeLocalTrxn: "20261024102109",
    MerchantId: 48804,
    MerchantReference: "HP-1001",
    Message: "Approved",
    PaidThrough: "Card",
    ResponseCode: "00",
    SystemReference: "bb618a47-45b3-458f-bf2f-c5dae8698bfa",
    TerminalId: 113176,
    TxnType: "Purchase",
    ...(overrides as Record<string, string | number>),
  };
  const SecureHash = amwalSecureHash({ ...fields, Amount: amountText }, KEY);
  const body = JSON.stringify({ ...fields, SecureHash }).replace(/\}$/, `,"Amount":${amountText}}`);
  return Buffer.from(body);
}

describe("secure hash", () => {
  it("sorts by key, skips nulls and joins key=value", () => {
    expect(amwalHashInput({ b: "2", a: "1", z: null, c: "" })).toBe("a=1&b=2&c=");
  });

  it("is the uppercase hex HMAC-SHA256 keyed with the hex-decoded secure key", () => {
    const fields = { MerchantId: 1, Amount: "1.025", SessionToken: "" };
    expect(amwalSecureHash(fields, KEY)).toBe(
      expectedHash("Amount=1.025&MerchantId=1&SessionToken="),
    );
  });
});

describe("Amwal Pay gateway", () => {
  it("is OMR only with a 0.100 minimum", () => {
    const { gateway } = setup();
    expect(gateway.supports("OMR", 100)).toBe(true);
    expect(gateway.supports("OMR", 99)).toBe(false);
    expect(gateway.supports("USD" as never, 5000)).toBe(false);
  });

  it("creates a signed launcher link keyed by the order number, without the secure key", async () => {
    const { gateway } = setup();
    const { ref, payment } = await gateway.createPayment(paymentInput);
    expect(ref).toEqual({ paymentId: null, sessionId: "HP-1001" });
    expect(payment).toMatchObject({ kind: "redirect", provider: "amwal" });
    const url = (payment as { redirectUrl: string }).redirectUrl;
    expect(url.startsWith(`${LAUNCHER}/`)).toBe(true);
    expect(url).not.toContain(KEY);
    expect(gateway.orderInLink(url.split("/").pop()!)).toBe("HP-1001");
  });

  it("rebuilds the link for a retried checkout from the stored reference", async () => {
    const { gateway } = setup();
    const resumed = await gateway.resumePayment({ paymentId: null, sessionId: "HP-1001" });
    expect(resumed).toMatchObject({ kind: "redirect", provider: "amwal" });
  });

  it("rejects a tampered or expired link", async () => {
    const { gateway, config } = setup();
    const { payment } = await gateway.createPayment(paymentInput);
    const token = (payment as { redirectUrl: string }).redirectUrl.split("/").pop()!;
    const forged = Buffer.from(JSON.stringify({ o: "HP-9999", x: 9_999_999_999 })).toString(
      "base64url",
    );
    expect(() => gateway.orderInLink(`${forged}.${token.split(".")[1]}`)).toThrow(
      PaymentProviderError,
    );
    const later = createAmwalGateway({
      ...config,
      now: () => new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
    });
    expect(() => later.orderInLink(token)).toThrow(/Expired/);
  });

  it("builds the SmartBox config with a server-side hash over the documented fields", () => {
    const { gateway } = setup();
    const launch = gateway.launch({
      number: "HP-1001",
      amountCents: 1025,
      returnUrl: "https://shop.example/checkout/return?number=HP-1001",
    });
    expect(launch.scriptUrl).toBe("https://test.amwalpg.com:7443/js/SmartBox.js?v=1.1");
    expect(launch.config).toMatchObject({
      MID: 48804,
      TID: 113176,
      CurrencyId: 512,
      AmountTrxn: "1.025",
      MerchantReference: "HP-1001",
      TrxDateTime: "2026-10-24T10:21:09.735Z",
      CancelUrl: "https://shop.example/checkout/return?number=HP-1001&cancelled=1",
    });
    expect(launch.config.SecureHash).toBe(
      expectedHash(
        "Amount=1.025&CurrencyId=512&MerchantId=48804&MerchantReference=HP-1001&RequestDateTime=2026-10-24T10:21:09.735Z&SessionToken=&TerminalId=113176",
      ),
    );
    expect(JSON.stringify(launch)).not.toContain(KEY);
  });

  it("reports an approved Purchase as succeeded, in baisa, with the transaction id", async () => {
    const { gateway, calls } = setup({
      success: true,
      data: [
        { id: "g-2", amount: 12.5, responseCode: "51", transactionType: "Purchase" },
        { id: "g-1", amount: 12.5, responseCode: "00", transactionType: "Purchase" },
      ],
    });
    const status = await gateway.getPaymentStatus({ paymentId: null, sessionId: "HP-1001" });
    expect(status).toEqual({ status: "succeeded", amountCents: 12_500, paymentId: "g-1" });
    expect(calls[0]!.url).toBe("https://test.amwalpg.com:14443/Transaction/GetByMerchantReference");
    expect(calls[0]!.body).toMatchObject({
      merchantId: 48804,
      merchantReference: "HP-1001",
      requestDateTime: "20261024102109",
    });
    expect(calls[0]!.body.secureHashValue).toBe(
      expectedHash("merchantId=48804&merchantReference=HP-1001&requestDateTime=20261024102109"),
    );
  });

  it("is still waiting when there is no approved Purchase", async () => {
    const { gateway } = setup({ success: true, data: [] });
    expect(await gateway.getPaymentStatus({ paymentId: null, sessionId: "HP-1001" })).toEqual({
      status: "requires_payment",
      amountCents: 0,
      paymentId: null,
    });
  });

  it("raises a provider error when Amwal refuses the call", async () => {
    const { gateway } = setup({ success: false, errorList: ["bad hash"] }, 400);
    await expect(
      gateway.getPaymentStatus({ paymentId: null, sessionId: "HP-1001" }),
    ).rejects.toThrow(/bad hash/);
  });

  it("refunds through /Execute/Refund with a stable request id and a signed body", async () => {
    const { gateway, calls } = setup({ success: true, data: { transactionId: "refund-1" } });
    const refund = { paymentId: "g-1", amountCents: 2500, idempotencyKey: "refund:1", reason: "x" };
    expect(await gateway.refund(refund)).toEqual({ id: "refund-1" });
    await gateway.refund(refund);
    expect(calls[0]!.url).toBe("https://test.amwalpg.com:14443/Execute/Refund");
    expect(calls[0]!.body).toMatchObject({
      transactionIdentifierValue: "g-1",
      transactionIdentifierType: 2,
      currencyCode: 512,
      amount: 2.5,
    });
    expect(calls[0]!.body.transactionId).toBe(calls[1]!.body.transactionId);
    const { secureHashValue, ...unsigned } = calls[0]!.body;
    expect(secureHashValue).toBe(amwalSecureHash(unsigned as Record<string, string | number>, KEY));
  });
});

describe("Amwal Pay notifications", () => {
  const parse = (gateway: AmwalGateway, body: Buffer) => gateway.parseWebhook(body, () => undefined);

  it("turns an approved, correctly signed Purchase into a status check by order number", () => {
    const { gateway } = setup();
    expect(parse(gateway, notification())).toEqual({
      id: "amwal:bb618a47-45b3-458f-bf2f-c5dae8698bfa:00",
      type: "check_payment",
      ref: { paymentId: null, sessionId: "HP-1001" },
    });
  });

  it("verifies Amount as written, so 1000.0 still matches", () => {
    const { gateway } = setup();
    expect(parse(gateway, notification({}, "1000.0")).type).toBe("check_payment");
  });

  it("ignores declined payments and other transaction types", () => {
    const { gateway } = setup();
    expect(parse(gateway, notification({ ResponseCode: "51" })).type).toBe("ignored");
    expect(parse(gateway, notification({ TxnType: "Refund" })).type).toBe("ignored");
  });

  it("rejects a wrong or missing signature", () => {
    const { gateway } = setup();
    const tampered = Buffer.from(notification().toString().replace("HP-1001", "HP-9999"));
    expect(() => parse(gateway, tampered)).toThrow(WebhookSignatureError);
    const unsigned = Buffer.from(JSON.stringify({ MerchantReference: "HP-1001" }));
    expect(() => parse(gateway, unsigned)).toThrow(WebhookSignatureError);
    expect(() => parse(gateway, Buffer.from("nope"))).toThrow(WebhookSignatureError);
  });
});
