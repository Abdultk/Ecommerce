import { describe, expect, it } from "vitest";
import { fingerprint, stableStringify } from "./fingerprint";

describe("stableStringify", () => {
  it("orders object keys so equal objects serialize the same", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
  });

  it("drops undefined properties like JSON.stringify and keeps nulls", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("serializes primitives and dates", () => {
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(3)).toBe("3");
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify(new Date("2026-10-10T00:00:00Z"))).toBe('"2026-10-10T00:00:00.000Z"');
  });
});

describe("fingerprint", () => {
  it("is a hex sha256 that ignores key order", () => {
    const a = fingerprint({ path: "/x", body: { delta: 1, reason: "RESTOCK" } });
    const b = fingerprint({ body: { reason: "RESTOCK", delta: 1 }, path: "/x" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("changes when any value changes", () => {
    expect(fingerprint({ delta: 1 })).not.toBe(fingerprint({ delta: 2 }));
  });
});
