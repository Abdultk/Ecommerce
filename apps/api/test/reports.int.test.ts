import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { z } from "zod";
import { ReportJob, envelope } from "@hp/contracts";
import { seedCatalog } from "../prisma/seed";
import type { ReportStorage } from "../src/lib/report-storage";
import { REPORT_RETENTION_MS, purgeExpiredReports } from "../src/modules/reports/report-retention";
import { bearer, buildApp, createUser, prisma, resetDb } from "./helpers";

let ctx = buildApp();
let admin = "";
let other = "";
let superAdmin = "";
let staff = "";

beforeEach(async () => {
  await resetDb();
  await seedCatalog(prisma);
  ctx = buildApp();
  admin = bearer(await createUser({ role: "ADMIN", email: "admin@example.test" }));
  other = bearer(await createUser({ role: "ADMIN", email: "other@example.test" }));
  superAdmin = bearer(await createUser({ role: "SUPER_ADMIN", email: "root@example.test" }));
  staff = bearer(await createUser({ role: "STAFF", email: "staff@example.test" }));
});

// Let queued jobs finish before the next test empties the database.
afterEach(() => ctx.reports.drain());

const RANGE = { from: "2026-09-01", to: "2026-09-30" };

const create = (body: object, token = admin) =>
  request(ctx.app).post("/api/v1/admin/reports").set("Authorization", token).send(body);
const getJob = (id: string, token = admin) =>
  request(ctx.app).get(`/api/v1/admin/reports/${id}`).set("Authorization", token);

const job = (body: unknown): ReportJob => {
  const parsed = envelope(ReportJob).parse(body) as unknown as {
    success: boolean;
    data: ReportJob;
  };
  if (!parsed.success) throw new Error("expected success");
  return parsed.data;
};

/** Queues a report, runs the queue, and returns the finished job as the requester sees it. */
async function finished(body: object, token = admin): Promise<ReportJob> {
  const res = await create(body, token);
  expect(res.status).toBe(202);
  await ctx.reports.drain();
  return job((await getJob(res.body.data.id, token)).body);
}

/** Fetches a fake-storage download link through the app (it points at API_PUBLIC_URL). */
const download = (url: string) =>
  request(ctx.app)
    .get(new URL(url).pathname + new URL(url).search)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

describe("POST /admin/reports", () => {
  it("needs analytics:export and a valid request", async () => {
    expect((await create({ type: "orders", format: "csv", range: RANGE }, staff)).status).toBe(403);
    expect((await create({ type: "secrets", format: "csv", range: RANGE })).status).toBe(400);
    expect((await create({ type: "orders", format: "pdf", range: RANGE })).status).toBe(400);
  });

  it("queues the job and audit-logs the export", async () => {
    const res = await create({ type: "customers", format: "csv", range: RANGE });
    expect(res.status).toBe(202);
    const queued = job(res.body);
    expect(queued).toMatchObject({
      type: "customers",
      format: "csv",
      status: "queued",
      downloadUrl: null,
      requestedByEmail: "admin@example.test",
      range: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "report.create" } });
    expect(entry).toMatchObject({ entity: "ReportJob", entityId: queued.id });
    expect(entry.after).toMatchObject({ type: "customers", format: "csv" });
  });

  it("is rate limited per admin", async () => {
    ctx = buildApp({ limits: { reportCreate: 2 } });
    for (let i = 0; i < 2; i += 1) {
      expect((await create({ type: "inventory", format: "csv", range: RANGE })).status).toBe(202);
    }
    expect((await create({ type: "inventory", format: "csv", range: RANGE })).status).toBe(429);
    expect((await create({ type: "inventory", format: "csv", range: RANGE }, other)).status).toBe(
      202,
    );
  });
});

describe("report files", () => {
  it("builds a CSV with formula cells neutralised", async () => {
    await createUser({ email: "evil@example.test" });
    await prisma.user.update({
      where: { email: "evil@example.test" },
      data: { firstName: '=HYPERLINK("http://evil.test","x")', lastName: "+1" },
    });
    const done = await finished({
      type: "customers",
      format: "csv",
      range: { from: "2020-01-01", to: "2020-12-31" },
    });
    expect(done.status).toBe("done");
    expect(done.downloadUrl).toMatch(/^http:\/\/localhost:4000\/api\/v1\/report-files\//);
    expect(new Date(done.downloadExpiresAt!).getTime()).toBeLessThanOrEqual(
      Date.now() + 5 * 60_000 + 1_000,
    );

    const file = await download(done.downloadUrl!);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/^text\/csv/);
    expect(file.headers["content-disposition"]).toMatch(
      /^attachment; filename="hearth-and-pan-customers-2020-01-01\.csv"$/,
    );
    expect(file.headers["cache-control"]).toBe("no-store");
    const text = (file.body as Buffer).toString("utf8");
    expect(text.split("\r\n")[0]).toBe(
      "email,first_name,last_name,signed_up_at,email_verified,orders_in_range,net_spent_in_range_cents,last_order_at",
    );
    expect(text).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`);
    expect(text).toContain(",'+1,");
    expect(text).not.toContain("staff@example.test"); // customers only
    expect(done.rowCount).toBe(1);
  });

  it("builds XLSX workbooks and the other report types", async () => {
    const xlsx = await finished({ type: "inventory", format: "xlsx", range: RANGE });
    const variants = await prisma.productVariant.count();
    expect(xlsx.rowCount).toBe(variants);
    const file = await download(xlsx.downloadUrl!);
    expect(file.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect((file.body as Buffer).subarray(0, 2).toString("latin1")).toBe("PK");

    expect((await finished({ type: "sales-by-day", format: "csv", range: RANGE })).rowCount).toBe(
      30,
    );
    expect((await finished({ type: "orders", format: "csv", range: RANGE })).rowCount).toBe(0);
  });

  it("refuses tampered or expired links", async () => {
    const done = await finished({ type: "inventory", format: "csv", range: RANGE });
    const url = new URL(done.downloadUrl!);
    const tampered = new URL(url);
    tampered.searchParams.set("name", "other.csv");
    expect((await download(tampered.toString())).status).toBe(403);
    const otherFile = new URL(url);
    otherFile.pathname = otherFile.pathname.replace(/[^/]+$/, "zzz.csv");
    expect((await download(otherFile.toString())).status).toBe(403);
    const expired = new URL(url);
    expired.searchParams.set("expires", "1000");
    expect((await download(expired.toString())).status).toBe(403);
    expect(
      (
        await download(
          `http://localhost:4000/api/v1/report-files/..%2F..%2Fetc%2Fpasswd?expires=9999999999&sig=x&name=a.csv`,
        )
      ).status,
    ).toBe(403);
  });

  it("marks the job failed with a safe message when generation fails", async () => {
    const broken: ReportStorage = {
      kind: "r2",
      put: async () => {
        throw new Error("bucket ada@example.test is gone");
      },
      delete: async () => undefined,
      downloadUrl: async () => ({ url: "https://x.test", expiresAt: new Date() }),
    };
    ctx = buildApp({ reportStorage: broken });
    const done = await finished({ type: "inventory", format: "csv", range: RANGE });
    expect(done).toMatchObject({
      status: "failed",
      downloadUrl: null,
      error: "The report couldn't be generated. Please try again.",
    });
  });
});

describe("who can see a report", () => {
  it("is limited to the requester and super admins", async () => {
    const done = await finished({ type: "inventory", format: "csv", range: RANGE });
    expect((await getJob(done.id, other)).status).toBe(404);
    expect((await getJob(done.id, staff)).status).toBe(403);
    const asRoot = await getJob(done.id, superAdmin);
    expect(asRoot.status).toBe(200);
    expect(asRoot.body.data.downloadUrl).not.toBeNull();
    expect((await getJob("does-not-exist")).status).toBe(404);
  });

  it("lists the caller's own jobs newest first; super admins see all", async () => {
    await create({ type: "inventory", format: "csv", range: RANGE });
    await create({ type: "orders", format: "xlsx", range: RANGE });
    await create({ type: "customers", format: "csv", range: RANGE }, other);
    await ctx.reports.drain();
    const list = (token: string) =>
      request(ctx.app).get("/api/v1/admin/reports?pageSize=10").set("Authorization", token);

    const mine = await list(admin);
    expect(mine.status).toBe(200);
    const items = z.array(ReportJob).parse(mine.body.data);
    expect(items.map((j) => j.type)).toEqual(["orders", "inventory"]);
    expect(mine.body.meta.total).toBe(2);
    expect((await list(superAdmin)).body.meta.total).toBe(3);
    expect((await list(staff)).status).toBe(403);
  });
});

describe("retention (security review M6)", () => {
  it("stops signing links after the retention period and the purge deletes the file", async () => {
    const old = await finished({ type: "inventory", format: "csv", range: RANGE });
    const oldLink = old.downloadUrl!;
    const fresh = await finished({ type: "inventory", format: "xlsx", range: RANGE });
    await prisma.reportJob.update({
      where: { id: old.id },
      data: { completedAt: new Date(Date.now() - REPORT_RETENTION_MS - 60_000) },
    });

    // Past retention but not yet purged: no new link is signed.
    expect(job((await getJob(old.id)).body).downloadUrl).toBeNull();

    expect(await purgeExpiredReports(prisma, ctx.reportStorage)).toBe(1);
    const expired = job((await getJob(old.id)).body);
    expect(expired).toMatchObject({ status: "expired", downloadUrl: null });
    expect(
      (await prisma.reportJob.findUniqueOrThrow({ where: { id: old.id } })).storageKey,
    ).toBeNull();
    expect((await download(oldLink)).status).toBe(403); // the file is gone

    expect(job((await getJob(fresh.id)).body)).toMatchObject({ status: "done" });
    expect(await purgeExpiredReports(prisma, ctx.reportStorage)).toBe(0);
  });
});
