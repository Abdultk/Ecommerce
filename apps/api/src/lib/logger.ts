import { pino } from "pino";
import { env } from "../config/env";
import { loggerOptions } from "./log-options";

// Structured JSON logs. Secrets and personal data are redacted at the source (log-options.ts).
export const logger = pino(
  loggerOptions({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === "development" }),
);
