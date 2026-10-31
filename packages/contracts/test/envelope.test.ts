import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ERROR_CODES, ERROR_HTTP_STATUS, envelope, fail, ok, paged } from "../src/envelope";

const Item = z.object({ id: z.string() });

describe("envelope", () => {
  it("accepts a success response", () => {
    const body = envelope(Item).parse({ success: true, data: { id: "a" }, error: null });
    expect(body.data).toEqual({ id: "a" });
  });

  it("accepts a failure response", () => {
    const body = envelope(Item).parse({
      success: false,
      data: null,
      error: { code: "NOT_FOUND", message: "Product not found." },
    });
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("rejects a success response that also carries an error", () => {
    const result = envelope(Item).safeParse({
      success: true,
      data: { id: "a" },
      error: { code: "INTERNAL", message: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a failure response without an error", () => {
    expect(envelope(Item).safeParse({ success: false, data: null, error: null }).success).toBe(
      false,
    );
  });

  it("rejects a failure response that also carries data", () => {
    const result = envelope(Item).safeParse({
      success: false,
      data: { id: "a" },
      error: { code: "INTERNAL", message: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown error codes", () => {
    const result = envelope(Item).safeParse({
      success: false,
      data: null,
      error: { code: "TEAPOT", message: "x" },
    });
    expect(result.success).toBe(false);
  });
});

describe("response helpers", () => {
  it("ok() builds a valid success envelope", () => {
    expect(envelope(Item).parse(ok({ id: "a" }))).toEqual({
      success: true,
      data: { id: "a" },
      error: null,
    });
  });

  it("fail() builds a valid failure envelope with optional details", () => {
    const body = fail("OUT_OF_STOCK", "Only 2 left.", { available: 2 });
    expect(envelope(Item).parse(body).error).toEqual({
      code: "OUT_OF_STOCK",
      message: "Only 2 left.",
      details: { available: 2 },
    });
  });

  it("fail() omits details when none are given", () => {
    expect(fail("NOT_FOUND", "Product not found.").error).toEqual({
      code: "NOT_FOUND",
      message: "Product not found.",
    });
  });

  it("paged() computes totalPages", () => {
    const body = paged([{ id: "a" }], { page: 2, pageSize: 24, total: 49 });
    expect(body.meta).toEqual({ page: 2, pageSize: 24, total: 49, totalPages: 3 });
    expect(envelope(z.array(Item)).safeParse(body).success).toBe(true);
  });

  it("paged() reports zero pages for an empty result", () => {
    expect(paged([], { page: 1, pageSize: 24, total: 0 }).meta.totalPages).toBe(0);
  });
});

describe("ERROR_HTTP_STATUS", () => {
  it("maps every error code to an HTTP error status", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_HTTP_STATUS[code]).toBeLessThan(600);
    }
  });
});
