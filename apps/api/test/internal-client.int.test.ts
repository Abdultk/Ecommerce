import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "./helpers";

// D-04: storefront SSR calls share one server IP. With the internal token, the API keys
// per-IP limits on the end user's address forwarded in X-HP-Client-IP; without it, that
// header is ignored so public callers can't pick their own bucket.
const TOKEN = process.env.INTERNAL_API_TOKEN!;

const hit = (app: ReturnType<typeof buildApp>["app"], headers: Record<string, string> = {}) => {
  let req = request(app).get("/api/v1/health/live");
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return req;
};

describe("forwarded client address for per-IP limits", () => {
  it("ignores X-HP-Client-IP from a public caller (spoofing can't escape the limit)", async () => {
    const { app } = buildApp({ limits: { general: 2 } });
    expect((await hit(app, { "X-HP-Client-IP": "198.51.100.1" })).status).toBe(200);
    expect((await hit(app, { "X-HP-Client-IP": "198.51.100.2" })).status).toBe(200);
    expect((await hit(app, { "X-HP-Client-IP": "198.51.100.3" })).status).toBe(429);
  });

  it("keys the limit on the forwarded address when the internal token matches", async () => {
    const { app } = buildApp({ limits: { general: 2 } });
    const as = (ip: string) => ({ "X-Internal-Token": TOKEN, "X-HP-Client-IP": ip });
    // Many shoppers behind one SSR server each get their own bucket...
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3", "2001:db8::1"]) {
      expect((await hit(app, as(ip))).status).toBe(200);
    }
    // ...and one shopper is still limited.
    expect((await hit(app, as("198.51.100.1"))).status).toBe(200);
    expect((await hit(app, as("198.51.100.1"))).status).toBe(429);
  });

  it("ignores the header when the token is wrong", async () => {
    const { app } = buildApp({ limits: { general: 2 } });
    const bad = (ip: string) => ({ "X-Internal-Token": `${TOKEN}x`, "X-HP-Client-IP": ip });
    expect((await hit(app, bad("198.51.100.1"))).status).toBe(200);
    expect((await hit(app, bad("198.51.100.2"))).status).toBe(200);
    expect((await hit(app, bad("198.51.100.3"))).status).toBe(429);
  });

  it("falls back to the connection address when the forwarded value isn't an IP", async () => {
    const { app } = buildApp({ limits: { general: 2 } });
    const odd = (ip: string) => ({ "X-Internal-Token": TOKEN, "X-HP-Client-IP": ip });
    expect((await hit(app, odd("not-an-ip"))).status).toBe(200);
    expect((await hit(app, odd("1.2.3.4, 5.6.7.8"))).status).toBe(200);
    expect((await hit(app, odd("also bad"))).status).toBe(429);
  });

  it("puts token-only requests (cacheable SSR reads) in their own internal bucket", async () => {
    const { app } = buildApp({ limits: { general: 2, internal: 3 } });
    const internal = { "X-Internal-Token": TOKEN };
    for (let i = 0; i < 3; i += 1) expect((await hit(app, internal)).status).toBe(200);
    expect((await hit(app, internal)).status).toBe(429);
    // The server's own address bucket is untouched by internal traffic...
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(200);
    expect((await hit(app)).status).toBe(429);
  });

  it("doesn't give a wrong token the internal bucket", async () => {
    const { app } = buildApp({ limits: { general: 1, internal: 100 } });
    const bad = { "X-Internal-Token": `${TOKEN}x` };
    expect((await hit(app, bad)).status).toBe(200);
    expect((await hit(app, bad)).status).toBe(429);
  });
});
