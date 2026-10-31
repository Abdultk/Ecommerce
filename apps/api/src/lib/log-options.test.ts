import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import { loggerOptions } from "./log-options";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString("utf8"));
      done();
    },
  });
  return { lines, stream };
}

describe("request log redaction", () => {
  it("redacts the internal token, forwarded client IP, auth, cookies and signatures", async () => {
    const { lines, stream } = capture();
    const logger = pino(loggerOptions({ level: "info", pretty: false }), stream);
    const app = express();
    app.use(pinoHttp({ logger }));
    app.get("/x", (_req, res) => res.json({ ok: true }));

    await request(app)
      .get("/x")
      .set("X-Internal-Token", "internal-token-value-0123456789abcdef")
      .set("X-HP-Client-IP", "203.0.113.9")
      .set("Authorization", "Bearer secret-bearer")
      .set("Cookie", "hp_refresh=secret-cookie")
      .set("Stripe-Signature", "t=1,v1=secret-sig")
      .set("User-Agent", "kept-agent");

    const text = lines.join("");
    expect(text).toContain("request completed");
    for (const secret of [
      "internal-token-value",
      "203.0.113.9",
      "secret-bearer",
      "secret-cookie",
      "secret-sig",
    ]) {
      expect(text).not.toContain(secret);
    }
    const entry = JSON.parse(lines.find((l) => l.includes("request completed"))!);
    expect(entry.req.headers["x-internal-token"]).toBe("[redacted]");
    expect(entry.req.headers["x-hp-client-ip"]).toBe("[redacted]");
    expect(entry.req.headers["user-agent"]).toBe("kept-agent");
  });

  it("uses pino-pretty only when asked", () => {
    expect(loggerOptions({ level: "info", pretty: true }).transport).toMatchObject({
      target: "pino-pretty",
    });
    expect(loggerOptions({ level: "warn", pretty: false }).transport).toBeUndefined();
  });
});
