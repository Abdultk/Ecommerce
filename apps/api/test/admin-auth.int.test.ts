import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { authenticator } from "otplib";
import { AdminChallenge, AuthSession, PublicUser, envelope } from "@hp/contracts";
import {
  ADMIN,
  PASSWORD,
  TEST_TOTP_SECRET,
  WEB,
  acceptInviteFor,
  buildApp,
  cookieFrom,
  createUser,
  inviteTokenFor,
  prisma,
  resetDb,
  setCookieHeader,
} from "./helpers";

const { app } = buildApp();

beforeEach(resetDb);

const adminLogin = (email: string, password = PASSWORD) =>
  request(app).post("/api/v1/admin/auth/login").send({ email, password });

const secretFrom = (otpauthUrl: string) => new URL(otpauthUrl).searchParams.get("secret")!;

/** Full enrollment through an invite: returns the TOTP secret and the first session. */
async function enroll(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const challenge = envelope(AdminChallenge).parse((await acceptInviteFor(app, user.id)).body);
  if (!challenge.success) throw new Error("accept-invite failed");
  const secret = secretFrom(challenge.data.otpauthUrl!);
  const code = authenticator.generate(secret);
  const res = await request(app)
    .post("/api/v1/admin/auth/2fa")
    .send({ challengeToken: challenge.data.challengeToken, code });
  return { secret, code, res };
}

const acceptWith = (token: string) =>
  request(app).post("/api/v1/admin/auth/accept-invite").send({ token, password: PASSWORD });

describe("POST /admin/auth/login", () => {
  it("refuses non-admin accounts with the generic error", async () => {
    await createUser({ email: "shopper@example.test" });
    const res = await adminLogin("shopper@example.test");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });

  it("refuses a wrong password", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    expect((await adminLogin("boss@example.test", "wrong wrong wrong")).status).toBe(401);
  });

  it("refuses an admin who hasn't enrolled 2FA through an invite", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN", enrolled: false });
    const res = await adminLogin("boss@example.test");
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/invite/);
    expect(res.body.data ?? null).toBeNull();
  });

  it("returns a challenge without any secret for an enrolled admin", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    const body = envelope(AdminChallenge).parse((await adminLogin("boss@example.test")).body);
    expect(body.success && body.data).toMatchObject({ enrollmentRequired: false });
    expect(body.success && body.data.otpauthUrl).toBeUndefined();
  });
});

describe("POST /admin/auth/accept-invite", () => {
  it("sets the password and starts enrollment with an encrypted secret", async () => {
    const admin = await createUser({ email: "boss@example.test", role: "ADMIN", enrolled: false });
    const res = await acceptInviteFor(app, admin.id);
    expect(res.status).toBe(200);
    const body = envelope(AdminChallenge).parse(res.body);
    if (!body.success) throw new Error("expected success");
    expect(body.data.enrollmentRequired).toBe(true);
    expect(body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stored.totpSecretEnc).toBeTruthy();
    expect(stored.totpSecretEnc).not.toContain(secretFrom(body.data.otpauthUrl!));
    expect(stored.totpEnabledAt).toBeNull();
  });

  it("works only once", async () => {
    const admin = await createUser({ email: "boss@example.test", role: "ADMIN", enrolled: false });
    const token = await inviteTokenFor(admin.id);
    expect((await acceptWith(token)).status).toBe(200);
    expect((await acceptWith(token)).status).toBe(400);
  });

  it("refuses an unknown token", async () => {
    expect((await acceptWith("x".repeat(43))).status).toBe(400);
  });

  it("refuses an account that has since been disabled", async () => {
    const admin = await createUser({ email: "boss@example.test", role: "ADMIN", enrolled: false });
    const token = await inviteTokenFor(admin.id);
    await prisma.user.update({ where: { id: admin.id }, data: { disabledAt: new Date() } });
    expect((await acceptWith(token)).status).toBe(400);
  });
});

describe("POST /admin/auth/2fa", () => {
  it("completes enrollment and returns an admin session with a strict cookie", async () => {
    await createUser({ email: "boss@example.test", role: "SUPER_ADMIN" });
    const { res } = await enroll("boss@example.test");
    expect(res.status).toBe(200);
    const body = envelope(AuthSession).parse(res.body);
    expect(body.success && body.data.user.role).toBe("SUPER_ADMIN");
    expect(setCookieHeader(res, "hp_admin_refresh")).toMatch(/SameSite=Strict/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "boss@example.test" } });
    expect(user.totpEnabledAt).not.toBeNull();
  });

  it("rejects a wrong code", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    const challenge = (await adminLogin("boss@example.test")).body.data;
    const res = await request(app)
      .post("/api/v1/admin/auth/2fa")
      .send({ challengeToken: challenge.challengeToken, code: "000000" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("That code didn't work. Check your authenticator app.");
  });

  it("signs in an enrolled admin with a valid code", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    const challenge = (await adminLogin("boss@example.test")).body.data;
    const res = await request(app)
      .post("/api/v1/admin/auth/2fa")
      .send({
        challengeToken: challenge.challengeToken,
        code: authenticator.generate(TEST_TOTP_SECRET),
      });
    expect(res.status).toBe(200);
  });

  it("rejects a replayed code", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    // The enrolment spends this code; reusing the same string (not a fresh one) keeps the
    // test independent of the 30 s TOTP window, which a slow run can cross.
    const { code: usedCode, res: enrolled } = await enroll("boss@example.test");
    expect(enrolled.status).toBe(200);
    const challenge = (await adminLogin("boss@example.test")).body.data;
    const res = await request(app)
      .post("/api/v1/admin/auth/2fa")
      .send({ challengeToken: challenge.challengeToken, code: usedCode });
    expect(res.status).toBe(401);
  });

  it("rejects a forged challenge token", async () => {
    const res = await request(app)
      .post("/api/v1/admin/auth/2fa")
      .send({ challengeToken: "forged.token.value", code: "123456" });
    expect(res.status).toBe(401);
  });

  it("does not accept a customer access token as a challenge", async () => {
    await createUser({ email: "shopper@example.test" });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "shopper@example.test", password: PASSWORD });
    const res = await request(app)
      .post("/api/v1/admin/auth/2fa")
      .send({ challengeToken: login.body.data.accessToken, code: "123456" });
    expect(res.status).toBe(401);
  });
});

describe("admin-only routes", () => {
  it("allow an admin who passed 2FA", async () => {
    await createUser({ email: "boss@example.test", role: "STAFF" });
    const { res } = await enroll("boss@example.test");
    const me = await request(app)
      .get("/api/v1/admin/me")
      .set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(envelope(PublicUser).parse(me.body).data).toMatchObject({ role: "STAFF" });
  });

  it("refuse customers", async () => {
    await createUser({ email: "shopper@example.test" });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "shopper@example.test", password: PASSWORD });
    const res = await request(app)
      .get("/api/v1/admin/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Admin access only.");
  });

  it("require a token", async () => {
    expect((await request(app).get("/api/v1/admin/me")).status).toBe(401);
  });

  it("refuse an admin whose account was disabled after signing in", async () => {
    const admin = await createUser({ email: "boss@example.test", role: "ADMIN" });
    const { res } = await enroll("boss@example.test");
    await prisma.user.update({ where: { id: admin.id }, data: { disabledAt: new Date() } });
    const me = await request(app)
      .get("/api/v1/admin/me")
      .set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });
});

describe("admin session refresh", () => {
  it("uses the admin cookie when called from the admin origin and keeps 2FA", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    const { res } = await enroll("boss@example.test");
    const cookie = cookieFrom(res, "hp_admin_refresh")!;

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("Origin", ADMIN);
    expect(refreshed.status).toBe(200);
    const me = await request(app)
      .get("/api/v1/admin/me")
      .set("Authorization", `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it("ignores the admin cookie on requests from the storefront origin", async () => {
    await createUser({ email: "boss@example.test", role: "ADMIN" });
    const { res } = await enroll("boss@example.test");
    const cookie = cookieFrom(res, "hp_admin_refresh")!;
    const fromStore = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("Origin", WEB);
    expect(fromStore.status).toBe(401);
  });
});
