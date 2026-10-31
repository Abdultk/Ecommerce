import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { AuthSession, PublicUser, envelope } from "@hp/contracts";
import {
  PASSWORD,
  WEB,
  buildApp,
  cookieFrom,
  createUser,
  prisma,
  resetDb,
  setCookieHeader,
  tokenFromEmail,
} from "./helpers";

const { app, mailer } = buildApp();
const sessionEnvelope = envelope(AuthSession);

beforeEach(async () => {
  await resetDb();
  mailer.outbox.length = 0;
});

const registration = {
  email: "Ada@Example.test",
  password: PASSWORD,
  firstName: "Ada",
  lastName: "Cook",
};

async function login(email: string, password = PASSWORD) {
  return request(app).post("/api/v1/auth/login").send({ email, password });
}

describe("POST /auth/register", () => {
  it("creates the account, sends a verification link and signs nobody in", async () => {
    const res = await request(app).post("/api/v1/auth/register").send(registration);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, data: null });
    expect(res.headers["set-cookie"]).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.test" } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.emailVerifiedAt).toBeNull();
    expect(mailer.outbox).toHaveLength(1);
    // The token rides in the URL fragment so it never reaches a server log or Referer.
    expect(mailer.outbox[0]?.text).toContain(`${WEB}/verify-email#token=`);
    expect(mailer.outbox[0]?.text).not.toContain("?token=");
  });

  it("answers a duplicate email exactly like a new one and emails the owner instead", async () => {
    const first = await request(app).post("/api/v1/auth/register").send(registration);
    mailer.outbox.length = 0;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...registration, email: "ADA@example.test", password: "another long passphrase" });
    expect(res.status).toBe(first.status);
    expect(res.body).toEqual(first.body);
    expect(await prisma.user.count()).toBe(1);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]?.subject).toMatch(/Someone tried/);
    expect(mailer.outbox[0]?.text).not.toContain("verify-email#token=");
    // The existing password is untouched.
    expect((await login("ada@example.test")).status).toBe(200);
  });

  it("resends a verification link only to unverified accounts, with one generic answer", async () => {
    await request(app).post("/api/v1/auth/register").send(registration);
    mailer.outbox.length = 0;
    const send = (email: string) =>
      request(app).post("/api/v1/auth/resend-verification").send({ email });

    const unknown = await send("ghost@example.test");
    const pending = await send("ada@example.test");
    expect(pending.status).toBe(202);
    expect(pending.body).toEqual(unknown.body);
    expect(mailer.outbox).toHaveLength(1);

    await request(app)
      .post("/api/v1/auth/verify-email")
      .send({ token: tokenFromEmail(mailer.outbox[0]!.text) });
    mailer.outbox.length = 0;
    expect((await send("ada@example.test")).status).toBe(202);
    expect(mailer.outbox).toHaveLength(0);
  });

  it("validates the body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...registration, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.password).toBeDefined();
  });
});

describe("POST /auth/login", () => {
  it("returns a session and records the login", async () => {
    const user = await createUser({ email: "cook@example.test" });
    const res = await login("COOK@example.test");
    expect(res.status).toBe(200);
    sessionEnvelope.parse(res.body);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastLoginAt).not.toBeNull();
  });

  it.each([
    ["wrong password", "cook@example.test", "nope nope nope"],
    ["unknown email", "ghost@example.test", PASSWORD],
  ])("gives the same generic error for %s", async (_label, email, password) => {
    await createUser({ email: "cook@example.test" });
    const res = await login(email, password);
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: "UNAUTHENTICATED",
      message: "Email or password is incorrect.",
    });
  });

  it("refuses disabled accounts with the same generic error", async () => {
    await createUser({ email: "gone@example.test", disabled: true });
    const res = await login("gone@example.test");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });

  it("rate-limits repeated attempts from one client", async () => {
    const limited = buildApp({
      limits: { login: 2 },
    }).app;
    await createUser({ email: "cook@example.test" });
    const attempt = () =>
      request(limited)
        .post("/api/v1/auth/login")
        .send({ email: "cook@example.test", password: "wrong wrong" });
    await attempt();
    await attempt();
    const third = await attempt();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("GET /me", () => {
  it("returns the signed-in user", async () => {
    await createUser({ email: "cook@example.test" });
    const { body } = await login("cook@example.test");
    const res = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(envelope(PublicUser).parse(res.body).data).toMatchObject({ email: "cook@example.test" });
  });

  it.each([
    ["no token", undefined],
    ["a garbage token", "Bearer not.a.jwt"],
  ])("returns 401 with %s", async (_label, header) => {
    const req = request(app).get("/api/v1/me");
    const res = await (header ? req.set("Authorization", header) : req);
    expect(res.status).toBe(401);
  });
});

describe("refresh token rotation", () => {
  async function signedInCookie() {
    await createUser({ email: "cook@example.test" });
    const res = await login("cook@example.test");
    return cookieFrom(res, "hp_refresh")!;
  }

  const refresh = (cookie: string, origin: string | null = WEB) => {
    const req = request(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    return origin ? req.set("Origin", origin) : req;
  };

  it("issues a new session and a new cookie", async () => {
    const cookie = await signedInCookie();
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    sessionEnvelope.parse(res.body);
    const next = cookieFrom(res, "hp_refresh");
    expect(next).toBeDefined();
    expect(next).not.toBe(cookie);
  });

  it("treats reuse of a rotated token as theft and revokes the whole family", async () => {
    const original = await signedInCookie();
    const rotated = cookieFrom(await refresh(original), "hp_refresh")!;

    const reuse = await refresh(original);
    expect(reuse.status).toBe(401);

    const afterTheft = await refresh(rotated);
    expect(afterTheft.status).toBe(401);
  });

  it("requires an allowed Origin header (CSRF defense)", async () => {
    const cookie = await signedInCookie();
    expect((await refresh(cookie, null)).status).toBe(403);
    expect((await refresh(cookie, "https://evil.example")).status).toBe(403);
  });

  it("returns 401 without a cookie", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").set("Origin", WEB);
    expect(res.status).toBe(401);
  });

  it("logout revokes the session and clears the cookie", async () => {
    const cookie = await signedInCookie();
    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", WEB);
    expect(out.status).toBe(200);
    expect(setCookieHeader(out, "hp_refresh")).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe("email verification", () => {
  it("verifies once with the emailed token", async () => {
    await request(app).post("/api/v1/auth/register").send(registration);
    const token = tokenFromEmail(mailer.outbox[0]!.text);

    const ok = await request(app).post("/api/v1/auth/verify-email").send({ token });
    expect(ok.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.test" } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const again = await request(app).post("/api/v1/auth/verify-email").send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toBe("This link has expired or was already used.");
  });
});

describe("password reset", () => {
  it("always answers 202 so emails cannot be enumerated", async () => {
    const res = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "ghost@example.test" });
    expect(res.status).toBe(202);
    expect(mailer.outbox).toHaveLength(0);
  });

  it("resets the password, signs out other sessions and is single-use", async () => {
    await createUser({ email: "cook@example.test" });
    const oldCookie = cookieFrom(await login("cook@example.test"), "hp_refresh")!;

    const forgot = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "cook@example.test" });
    expect(forgot.status).toBe(202);
    expect(mailer.outbox.at(-1)!.text).toContain(`${WEB}/reset-password#token=`);
    expect(mailer.outbox.at(-1)!.text).not.toContain("?token=");
    const token = tokenFromEmail(mailer.outbox.at(-1)!.text);

    const newPassword = "a brand new long passphrase";
    const reset = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: newPassword });
    expect(reset.status).toBe(200);

    expect((await login("cook@example.test", newPassword)).status).toBe(200);
    expect((await login("cook@example.test")).status).toBe(401);

    const stale = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", oldCookie)
      .set("Origin", WEB);
    expect(stale.status).toBe(401);

    const reuse = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token, password: newPassword });
    expect(reuse.status).toBe(400);
  });
});

describe("admin accounts on the customer login", () => {
  it("get a session without 2FA, which admin routes refuse", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    const { body } = await login("boss@example.test");
    const res = await request(app)
      .get("/api/v1/admin/me")
      .set("Authorization", `Bearer ${body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Two-factor verification required.");
  });
});
