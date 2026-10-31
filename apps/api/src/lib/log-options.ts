import type { LoggerOptions } from "pino";

/** Never logged: credentials, the SSR trust token and the end-user address it vouches for. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-internal-token"]',
  'req.headers["x-hp-client-ip"]',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.code",
];

/** Structured JSON logs with secrets and personal data redacted at the source. */
export function loggerOptions(options: { level: string; pretty: boolean }): LoggerOptions {
  return {
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    transport: options.pretty ? { target: "pino-pretty", options: { colorize: true } } : undefined,
  };
}
