import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { PASSWORD, TEST_TOTP_SECRET, buildApp, createUser, resetDb } from "./helpers";

// Regression tests for the Phase 1 security review.

beforeEach(resetDb);

describe("cache headers", () => {
  const { app } = buildApp();

  it("never marks auth failures or unknown routes as publicly cacheable", async () => {
    const admin = await request(app).get("/api/v1/admin/me");
    expect(admin.status).toBe(401);
    expect(admin.headers["cache-control"]).toBe("no-store");

    const missing = await request(app).get("/api/v1/nope");
    expect(missing.headers["cache-control"]).toBe("no-store");
  });

  it("lets catalog reads be cached", async () => {
    const res = await request(app).get("/api/v1/categories");
    expect(res.headers["cache-control"]).toMatch(/^public/);
  });
});

describe("per-account login throttling", () => {
  it("limits attempts on one account even from many IPs", async () => {
    const { app } = buildApp({ limits: { loginPerAccount: 2 } });
    await createUser({ email: "cook@example.test" });
    const attempt = (ip: string) =>
      request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: "cook@example.test", password: "wrong wrong wrong" });

    expect((await attempt("198.51.100.1")).status).toBe(401);
    expect((await attempt("198.51.100.2")).status).toBe(401);
    const third = await attempt("198.51.100.3");
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  it("keeps admin sign-in on its own limiter", async () => {
    const { app } = buildApp({ limits: { login: 1 } });
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "x@example.test", password: "nope nope" });
    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "x@example.test", password: "nope" });
    expect(blocked.status).toBe(429);

    const admin = await request(app)
      .post("/api/v1/admin/auth/login")
      .send({ email: "boss@example.test", password: PASSWORD });
    expect(admin.status).toBe(200);
  });
});

describe("per-admin 2FA throttling", () => {
  it("limits wrong codes for one admin regardless of IP", async () => {
    const { app } = buildApp({ limits: { admin2faPerUser: 2 } });
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    const login = await request(app)
      .post("/api/v1/admin/auth/login")
      .send({ email: "boss@example.test", password: PASSWORD });
    const challengeToken = login.body.data.challengeToken as string;
    const secret = TEST_TOTP_SECRET;

    const wrong = (ip: string) =>
      request(app)
        .post("/api/v1/admin/auth/2fa")
        .set("X-Forwarded-For", ip)
        .send({ challengeToken, code: "000000" });
    expect((await wrong("198.51.100.1")).status).toBe(401);
    expect((await wrong("198.51.100.2")).status).toBe(401);
    expect((await wrong("198.51.100.3")).status).toBe(429);

    // Even the right code is refused while the account is locked out.
    const right = await request(app)
      .post("/api/v1/admin/auth/2fa")
      .send({ challengeToken, code: authenticator.generate(secret) });
    expect(right.status).toBe(429);
  });
});
