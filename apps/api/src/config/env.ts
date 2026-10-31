import { loadEnv } from "./env-schema";

export { loadEnv, type Env } from "./env-schema";

/** Validated once at startup; the schema and rules live in env-schema.ts (unit-tested). */
export const env = loadEnv();
