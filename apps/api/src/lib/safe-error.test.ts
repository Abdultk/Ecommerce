import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { safeErrorFields } from "./safe-error";

describe("safeErrorFields", () => {
  it("keeps the error type and stack frames but never the message", () => {
    const err = new TypeError("card 4242 4242 4242 4242 for ada@example.test");
    const fields = safeErrorFields(err);
    expect(fields.type).toBe("TypeError");
    expect(fields.stack).toMatch(/^\s*at /);
    expect(JSON.stringify(fields)).not.toContain("4242");
    expect(JSON.stringify(fields)).not.toContain("ada@example.test");
  });

  it("keeps string error codes such as Prisma's", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique failed on ada@example.test", {
      code: "P2002",
      clientVersion: "6",
    });
    const fields = safeErrorFields(err);
    expect(fields.code).toBe("P2002");
    expect(JSON.stringify(fields)).not.toContain("ada@example.test");
  });

  it("handles thrown non-errors without echoing them", () => {
    expect(safeErrorFields("secret string")).toEqual({ type: "string" });
    expect(safeErrorFields(null)).toEqual({ type: "null" });
    expect(safeErrorFields({ message: "x" })).toEqual({ type: "object" });
  });

  it("caps the number of stack frames", () => {
    const err = new Error("x");
    err.stack = [
      "Error: x",
      ...Array.from({ length: 50 }, (_, i) => `    at f${i} (a.js:1:1)`),
    ].join("\n");
    expect(safeErrorFields(err).stack?.split("\n")).toHaveLength(15);
  });
});
