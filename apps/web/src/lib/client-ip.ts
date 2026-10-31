import { isIP } from "node:net";
import { z } from "zod";

// Which request header names the shopper's IP (M2). Only the configured header is read —
// never a fallback — because any header the edge does not overwrite is client-controlled.
// No "@/" alias and no "server-only": env-check.ts (loaded by next.config.ts) imports this.

const MAX_TRUSTED_PROXY_HOPS = 10;

export type ClientIpSource =
  | { header: "cf-connecting-ip" }
  | { header: "x-forwarded-for"; trustedHops: number }
  | { header: "none" };

export type ClientIpEnv = Readonly<Record<string, string | undefined>>;

const HeaderSetting = z.enum(["cf-connecting-ip", "x-forwarded-for", "none"], {
  errorMap: () => ({
    message: "CLIENT_IP_HEADER must be cf-connecting-ip, x-forwarded-for or none.",
  }),
});

const HopsSetting = z.coerce
  .number({ invalid_type_error: "TRUSTED_PROXY_HOPS must be a whole number." })
  .int("TRUSTED_PROXY_HOPS must be a whole number.")
  .min(1, "TRUSTED_PROXY_HOPS must be at least 1.")
  .max(MAX_TRUSTED_PROXY_HOPS, `TRUSTED_PROXY_HOPS must be at most ${MAX_TRUSTED_PROXY_HOPS}.`);

/** Every problem with the client-IP settings; empty when they are valid (or unset). */
export function clientIpSettingProblems(env: ClientIpEnv): string[] {
  const header = HeaderSetting.safeParse(env.CLIENT_IP_HEADER ?? "cf-connecting-ip");
  const hops = HopsSetting.safeParse(env.TRUSTED_PROXY_HOPS ?? "1");
  return [
    ...(header.success ? [] : header.error.issues.map((i) => i.message)),
    ...(hops.success ? [] : [hops.error.issues[0]?.message ?? "TRUSTED_PROXY_HOPS is invalid."]),
  ];
}

/** Defaults: Cloudflare's header (Cloudflare overwrites it) and one trusted proxy hop. */
export function clientIpSourceFrom(env: ClientIpEnv): ClientIpSource {
  const problems = clientIpSettingProblems(env);
  if (problems.length) throw new Error(problems.join(" "));
  const header = HeaderSetting.parse(env.CLIENT_IP_HEADER ?? "cf-connecting-ip");
  if (header !== "x-forwarded-for") return { header };
  return { header, trustedHops: HopsSetting.parse(env.TRUSTED_PROXY_HOPS ?? "1") };
}

/** X-Forwarded-For grows by one entry per proxy; the entry `hops` from the end is the
 *  address the outermost trusted proxy saw. Earlier entries are client-controlled. */
function fromForwardedFor(value: string | null, trustedHops: number): string {
  const entries = (value ?? "").split(",").map((entry) => entry.trim());
  return entries[entries.length - trustedHops] ?? "";
}

/** The shopper's IP from the configured header only, or null if absent or not an IP. */
export function clientIpFrom(requestHeaders: Headers, source: ClientIpSource): string | null {
  if (source.header === "none") return null;
  const candidate =
    source.header === "x-forwarded-for"
      ? fromForwardedFor(requestHeaders.get("x-forwarded-for"), source.trustedHops)
      : (requestHeaders.get("cf-connecting-ip") ?? "").trim();
  return isIP(candidate) ? candidate : null;
}
