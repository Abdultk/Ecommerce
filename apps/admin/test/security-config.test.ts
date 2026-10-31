import { describe, expect, it } from "vitest";
import { assertProductionEnv, productionEnvProblems, uploadOriginFor } from "@/lib/env-check";
import { buildCsp, staticSecurityHeaders } from "@/lib/security-headers";

const PROD_ENV = {
  NEXT_PUBLIC_API_URL: "https://api.hearthandpan.com/api/v1",
  NEXT_PUBLIC_CDN_URL: "https://img.hearthandpan.com",
  NEXT_PUBLIC_UPLOAD_ORIGIN: "https://hp-product-images.abc123.r2.cloudflarestorage.com",
};

const cspFor = (production: boolean, uploadOrigin = PROD_ENV.NEXT_PUBLIC_UPLOAD_ORIGIN) =>
  buildCsp({
    apiUrl: PROD_ENV.NEXT_PUBLIC_API_URL,
    nonce: "abc",
    isDev: !production,
    cdnUrl: PROD_ENV.NEXT_PUBLIC_CDN_URL,
    uploadOrigin,
  });

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("production CSP", () => {
  it("allows only the exact upload host and the configured image CDN", () => {
    const csp = cspFor(true);
    expect(directive(csp, "connect-src")).toBe(
      "connect-src 'self' https://api.hearthandpan.com https://hp-product-images.abc123.r2.cloudflarestorage.com",
    );
    expect(directive(csp, "img-src")).toBe(
      "img-src 'self' data: blob: https://img.hearthandpan.com",
    );
    expect(csp).not.toContain("cdn.example.test");
    expect(csp).not.toContain("*");
  });

});

describe("staticSecurityHeaders", () => {
  it("adds HSTS in production only", () => {
    const hsts = (prod: boolean) =>
      staticSecurityHeaders({ production: prod }).find(
        (h) => h.key === "Strict-Transport-Security",
      );
    expect(hsts(true)?.value).toBe("max-age=63072000; includeSubDomains; preload");
    expect(hsts(false)).toBeUndefined();
  });

  it("always denies framing and indexing", () => {
    const keys = staticSecurityHeaders({ production: false }).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["X-Frame-Options", "X-Robots-Tag"]));
  });
});

describe("productionEnvProblems", () => {
  it("accepts a complete production configuration", () => {
    expect(productionEnvProblems(PROD_ENV)).toEqual([]);
    expect(() => assertProductionEnv(PROD_ENV)).not.toThrow();
  });

  it("requires the exact upload host, not a wildcard or a path", () => {
    const problems = (origin: string | undefined) =>
      productionEnvProblems({ ...PROD_ENV, NEXT_PUBLIC_UPLOAD_ORIGIN: origin });
    expect(problems(undefined)).toEqual([expect.stringContaining("NEXT_PUBLIC_UPLOAD_ORIGIN")]);
    expect(problems("https://*.r2.cloudflarestorage.com")).toHaveLength(1);
    expect(problems("https://bucket.r2.cloudflarestorage.com/path")).toHaveLength(1);
    expect(problems("http://bucket.r2.cloudflarestorage.com")).toHaveLength(1);
    expect(problems("not a url")).toHaveLength(1);
  });

  it("requires a real https CDN and API URL", () => {
    expect(productionEnvProblems({ ...PROD_ENV, NEXT_PUBLIC_CDN_URL: undefined })).toHaveLength(1);
    expect(
      productionEnvProblems({ ...PROD_ENV, NEXT_PUBLIC_CDN_URL: "https://cdn.example.test" }),
    ).toHaveLength(1);
    expect(productionEnvProblems({ ...PROD_ENV, NEXT_PUBLIC_API_URL: undefined })).toHaveLength(1);
    expect(
      productionEnvProblems({ ...PROD_ENV, NEXT_PUBLIC_API_URL: "http://api.example.com" }),
    ).toHaveLength(1);
  });

  it("allows a localhost API for local production smoke runs", () => {
    expect(
      productionEnvProblems({ ...PROD_ENV, NEXT_PUBLIC_API_URL: "http://localhost:4000/api/v1" }),
    ).toEqual([]);
  });

  it("throws one error naming every problem", () => {
    expect(() => assertProductionEnv({})).toThrow(
      /NEXT_PUBLIC_API_URL[\s\S]*NEXT_PUBLIC_CDN_URL[\s\S]*NEXT_PUBLIC_UPLOAD_ORIGIN/,
    );
  });
});

describe("uploadOriginFor", () => {
  it("uses the configured origin, falling back to the R2 wildcard outside production", () => {
    expect(uploadOriginFor({ NEXT_PUBLIC_UPLOAD_ORIGIN: "https://b.r2.dev" }, false)).toBe(
      "https://b.r2.dev",
    );
    expect(uploadOriginFor({}, false)).toBe("https://*.r2.cloudflarestorage.com");
    expect(uploadOriginFor({}, true)).toBe("");
    expect(uploadOriginFor({ NEXT_PUBLIC_UPLOAD_ORIGIN: "https://b.r2.dev/" }, true)).toBe(
      "https://b.r2.dev",
    );
  });
});
