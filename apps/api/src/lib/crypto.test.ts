import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashToken, randomToken, safeEqual } from "./crypto";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("encrypt / decrypt", () => {
  it("round-trips a TOTP secret", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(decrypt(encrypt(secret, KEY), KEY)).toBe(secret);
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", KEY)).not.toBe(encrypt("same", KEY));
  });

  it("rejects a tampered payload", () => {
    const payload = encrypt("secret", KEY);
    const raw = Buffer.from(payload, "base64url");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(() => decrypt(raw.toString("base64url"), KEY)).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("secret", KEY), OTHER_KEY)).toThrow();
  });

  it("rejects a truncated payload", () => {
    expect(() => decrypt("abc", KEY)).toThrow(/too short/);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => encrypt("x", "abcd")).toThrow(/32 bytes/);
  });
});

describe("tokens", () => {
  it("generates distinct URL-safe tokens", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it("hashes deterministically and depends on the pepper", () => {
    expect(hashToken("t", "p")).toBe(hashToken("t", "p"));
    expect(hashToken("t", "p")).not.toBe(hashToken("t", "q"));
    expect(hashToken("t")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compares in constant time and handles different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
