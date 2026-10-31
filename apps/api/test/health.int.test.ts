import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp, WEB } from "./helpers";

const { app } = buildApp();

describe("platform", () => {
  it("reports database health", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { db: "ok", redis: "skipped" }, error: null });
  });

  it("returns a NOT_FOUND envelope for unknown routes", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("sends security headers and hides the framework", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows CORS with credentials only for known origins", async () => {
    const allowed = await request(app).get("/api/v1/health").set("Origin", WEB);
    expect(allowed.headers["access-control-allow-origin"]).toBe(WEB);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const blocked = await request(app).get("/api/v1/health").set("Origin", "https://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
