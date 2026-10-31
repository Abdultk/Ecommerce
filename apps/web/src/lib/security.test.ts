import { describe, expect, it } from "vitest";
import { assertProductionEnv, productionEnvProblems } from "./env-check";
import {
  buildCsp,
  createNonce,
  imageRemotePatterns,
  staticSecurityHeaders,
  type CspOptions,
} from "./security-headers";

const PROD_ENV = {
  NEXT_PUBLIC_API_URL: "https://api.hearthandpan.com/api/v1",
  NEXT_PUBLIC_SITE_URL: "https://www.hearthandpan.com",
  NEXT_PUBLIC_CDN_URL: "https://img.hearthandpan.com",
  INTERNAL_API_TOKEN: "k".repeat(48),
};

const options = (overrides: Partial<CspOptions> = {}): CspOptions => ({
  nonce: "bm9uY2U=",
  apiUrl: PROD_ENV.NEXT_PUBLIC_API_URL,
  cdnUrl: PROD_ENV.NEXT_PUBLIC_CDN_URL,
  isDev: false,
  isProduction: true,
  ...overrides,
});

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d === name || d.startsWith(`${name} `)) ?? "";

describe("buildCsp (production)", () => {
  const csp = buildCsp(options());

  it("allows scripts only by nonce with 'strict-dynamic' — no 'unsafe-inline' or 'unsafe-eval'", () => {
    expect(directive(csp, "script-src")).toBe(
      "script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic' https://js.stripe.com https://*.js.stripe.com",
    );
    expect(csp).not.toContain("'unsafe-inline' 'nonce");
    expect(directive(csp, "script-src")).not.toContain("unsafe");
  });

  it("allows Stripe's hosts for the Payment Element, 3-D Secure frames and API calls", () => {
    expect(directive(csp, "frame-src")).toBe(
      "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
    );
    expect(directive(csp, "connect-src")).toBe(
      "connect-src 'self' https://api.hearthandpan.com https://api.stripe.com",
    );
  });

  it("serves images only from self and the configured CDN — no fixture CDN or localhost", () => {
    expect(directive(csp, "img-src")).toBe(
      "img-src 'self' data: blob: https://img.hearthandpan.com https://*.stripe.com",
    );
    expect(csp).not.toContain("cdn.example.test");
    expect(csp).not.toContain("localhost");
  });

  it("locks down framing, plugins, base and forms, and upgrades insecure requests", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(directive(csp, "upgrade-insecure-requests")).toBe("upgrade-insecure-requests");
  });

  it("omits the CDN when none is configured", () => {
    expect(directive(buildCsp(options({ cdnUrl: "" })), "img-src")).toBe(
      "img-src 'self' data: blob: https://*.stripe.com",
    );
  });
});

describe("buildCsp (development and tests)", () => {
  it("adds eval and websockets for next dev, and keeps local image hosts", () => {
    const csp = buildCsp(
      options({ isDev: true, isProduction: false, apiUrl: "http://localhost:4000/api/v1" }),
    );
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain(" ws:");
    expect(directive(csp, "img-src")).toContain("https://cdn.example.test");
    expect(directive(csp, "img-src")).toContain("http://localhost:*");
    expect(directive(csp, "upgrade-insecure-requests")).toBe("");
  });
});

describe("createNonce", () => {
  it("returns a fresh base64 value each call", () => {
    const a = createNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(createNonce()).not.toBe(a);
  });
});

describe("staticSecurityHeaders", () => {
  const find = (production: boolean, key: string) =>
    staticSecurityHeaders({ production }).find((h) => h.key === key)?.value;

  it("sends HSTS in production only", () => {
    expect(find(true, "Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(find(false, "Strict-Transport-Security")).toBeUndefined();
  });

  it("denies framing and sniffing, and lets only Stripe's frame use the Payment Request API", () => {
    expect(find(false, "X-Frame-Options")).toBe("DENY");
    expect(find(false, "X-Content-Type-Options")).toBe("nosniff");
    expect(find(false, "Permissions-Policy")).toContain('payment=(self "https://js.stripe.com")');
    // The CSP is per request (middleware), never static.
    expect(find(true, "Content-Security-Policy")).toBeUndefined();
  });
});

describe("imageRemotePatterns", () => {
  it("allows only the configured CDN in production", () => {
    expect(
      imageRemotePatterns({ cdnUrl: PROD_ENV.NEXT_PUBLIC_CDN_URL, isProduction: true }),
    ).toEqual([{ protocol: "https", hostname: "img.hearthandpan.com" }]);
    expect(imageRemotePatterns({ cdnUrl: "", isProduction: true })).toEqual([]);
  });

  it("adds the fixture CDN and localhost outside production", () => {
    expect(imageRemotePatterns({ cdnUrl: "", isProduction: false })).toEqual([
      { protocol: "https", hostname: "cdn.example.test" },
      { protocol: "http", hostname: "localhost" },
    ]);
  });
});

describe("productionEnvProblems", () => {
  it("accepts a complete production configuration", () => {
    expect(productionEnvProblems(PROD_ENV)).toEqual([]);
    expect(() => assertProductionEnv(PROD_ENV)).not.toThrow();
  });

  it("refuses the E2E-only local payment page switch on an https site", () => {
    const problems = (env: Record<string, string | undefined>) =>
      productionEnvProblems({ ...PROD_ENV, ...env });
    expect(problems({ NEXT_PUBLIC_E2E_LOCAL_PAYMENT_PAGE: "true" })).toHaveLength(1);
    expect(
      problems({
        NEXT_PUBLIC_E2E_LOCAL_PAYMENT_PAGE: "true",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
      }),
    ).toEqual([]);
  });

  it("requires https API and site URLs, allowing localhost for local smoke runs", () => {
    const problems = (env: Record<string, string | undefined>) =>
      productionEnvProblems({ ...PROD_ENV, ...env });
    expect(problems({ NEXT_PUBLIC_API_URL: undefined })).toHaveLength(1);
    expect(problems({ NEXT_PUBLIC_API_URL: "http://api.example.com" })).toHaveLength(1);
    expect(problems({ NEXT_PUBLIC_SITE_URL: undefined })).toHaveLength(1);
    expect(problems({ NEXT_PUBLIC_SITE_URL: "not a url" })).toHaveLength(1);
    expect(
      problems({
        NEXT_PUBLIC_API_URL: "http://localhost:4000/api/v1",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3200",
      }),
    ).toEqual([]);
  });

  it("requires a real https image CDN", () => {
    const problems = (cdn: string | undefined) =>
      productionEnvProblems({ ...PROD_ENV, NEXT_PUBLIC_CDN_URL: cdn });
    expect(problems(undefined)).toHaveLength(1);
    expect(problems("http://img.hearthandpan.com")).toHaveLength(1);
    expect(problems("https://cdn.example.test")).toEqual([expect.stringContaining("fixture CDN")]);
  });

  it("requires a server-only internal API token of at least 32 characters (D-04)", () => {
    const problems = (token: string | undefined) =>
      productionEnvProblems({ ...PROD_ENV, INTERNAL_API_TOKEN: token });
    expect(problems(undefined)).toEqual([expect.stringContaining("INTERNAL_API_TOKEN")]);
    expect(problems("short")).toEqual([expect.stringContaining("at least 32")]);
    expect(problems("x".repeat(32))).toEqual([]);
    // The message never echoes the secret.
    expect(problems("s3cret-but-short").join(" ")).not.toContain("s3cret");
  });

  it("accepts only the supported client-IP header settings (M2)", () => {
    const problems = (env: Record<string, string>) =>
      productionEnvProblems({ ...PROD_ENV, ...env });
    expect(problems({ CLIENT_IP_HEADER: "cf-connecting-ip" })).toEqual([]);
    expect(problems({ CLIENT_IP_HEADER: "x-forwarded-for", TRUSTED_PROXY_HOPS: "2" })).toEqual([]);
    expect(problems({ CLIENT_IP_HEADER: "none" })).toEqual([]);
    expect(problems({ CLIENT_IP_HEADER: "x-real-ip" })).toEqual([
      expect.stringContaining("CLIENT_IP_HEADER"),
    ]);
    expect(problems({ TRUSTED_PROXY_HOPS: "0" })).toEqual([
      expect.stringContaining("TRUSTED_PROXY_HOPS"),
    ]);
  });

  it("throws one error naming every problem", () => {
    expect(() => assertProductionEnv({})).toThrow(
      /NEXT_PUBLIC_API_URL[\s\S]*NEXT_PUBLIC_SITE_URL[\s\S]*NEXT_PUBLIC_CDN_URL[\s\S]*INTERNAL_API_TOKEN/,
    );
  });
});
