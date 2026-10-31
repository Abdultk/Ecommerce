import { describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));

const { getNonce } = await import("./nonce");

describe("getNonce", () => {
  it("returns the nonce middleware put on the request", async () => {
    requestHeaders.value = new Headers({ "x-nonce": "abc123==" });
    expect(await getNonce()).toBe("abc123==");
  });

  it("is undefined when the request carries no (or a malformed) nonce", async () => {
    requestHeaders.value = new Headers();
    expect(await getNonce()).toBeUndefined();
    requestHeaders.value = new Headers({ "x-nonce": '"><script>' });
    expect(await getNonce()).toBeUndefined();
  });
});
