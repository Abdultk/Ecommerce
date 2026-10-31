import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { createApiClient } from "@hp/api-client";
import { fail, formatMoney } from "@hp/contracts";
import { MOCK_STORE_CONFIG } from "@/test/msw/store";
import { API_URL, server, setupMockApi } from "@/test/server";
import {
  DEFAULT_STORE_CONFIG,
  currencyName,
  freeShippingText,
  getStoreConfig,
} from "./store-config";

setupMockApi();
const api = createApiClient(API_URL);

describe("store config", () => {
  it("reads the public store settings from GET /store", async () => {
    expect(await getStoreConfig(api)).toEqual(MOCK_STORE_CONFIG);
  });

  it("rejects a malformed answer instead of trusting it", async () => {
    server.use(
      http.get(`${API_URL}/store`, () =>
        HttpResponse.json({ success: true, data: { currency: "XXX" } }),
      ),
    );
    await expect(getStoreConfig(api)).rejects.toThrow();
    server.use(
      http.get(`${API_URL}/store`, () =>
        HttpResponse.json(fail("INTERNAL", "Down"), { status: 500 }),
      ),
    );
    await expect(getStoreConfig(api)).rejects.toThrow("Down");
  });

  it("falls back to an Omani store with card payments only", () => {
    expect(DEFAULT_STORE_CONFIG).toMatchObject({ currency: "OMR", paymentMethods: ["card"] });
  });

  it("words the free-shipping banner from the threshold, or leaves it out", () => {
    expect(freeShippingText(MOCK_STORE_CONFIG)).toBe(
      `Free shipping over ${formatMoney(30_000, "OMR")}`,
    );
    expect(freeShippingText({ ...MOCK_STORE_CONFIG, freeShippingThresholdCents: null })).toBeNull();
  });

  it("names the currency for people", () => {
    expect(currencyName("OMR")).toBe("Omani rial");
  });
});
