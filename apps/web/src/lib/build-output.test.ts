import { describe, expect, it } from "vitest";
import { MOCK_MARKERS, findClientSecrets, findMockLeaks } from "./build-output";

describe("findMockLeaks", () => {
  it("names each mock artefact found in a build file", () => {
    const source = 'const t=`mock-access-${n}`;const INTEGRITY_CHECKSUM="x";';
    expect(findMockLeaks("chunks/1.js", source)).toEqual([
      "chunks/1.js: contains the MSW service worker script",
      "chunks/1.js: contains mock API auth handlers (src/test/msw)",
    ]);
  });

  it("passes clean production code", () => {
    expect(findMockLeaks("chunks/2.js", "export const API_URL='https://api.test'")).toEqual([]);
  });

  it("covers the worker, mock auth, mock seed data and the sample catalog", () => {
    expect(MOCK_MARKERS.map((m) => m.text)).toEqual(
      expect.arrayContaining(["INTEGRITY_CHECKSUM", "mock-access-", "u_mock_0001", "p_sample_01"]),
    );
  });
});

describe("findClientSecrets", () => {
  it("flags the internal API token header or variable in a browser chunk (D-04)", () => {
    expect(findClientSecrets("static/chunks/a.js", 'h["X-Internal-Token"]=t')).toEqual([
      "static/chunks/a.js: contains the internal API token header (server-only)",
    ]);
    expect(findClientSecrets("static/chunks/b.js", "process.env.INTERNAL_API_TOKEN")).toHaveLength(
      1,
    );
    expect(findClientSecrets("static/chunks/c.js", "fetch('/cart')")).toEqual([]);
  });
});
