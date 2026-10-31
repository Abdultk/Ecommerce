import { HttpResponse } from "msw";
import {
  ERROR_HTTP_STATUS,
  can,
  fail,
  isAdminRole,
  ok,
  paged,
  type AuditLogEntry,
  type ErrorCode,
  type Permission,
} from "@hp/contracts";
import type { z } from "zod";
import { userIdForToken } from "./accounts";
import type { MockStore } from "./db";
import type { MockDb, MockUser } from "./types";

// Shared plumbing for the mock handlers: envelopes, auth, validation and audit.

export type MockContext = {
  baseUrl: string;
  store: MockStore;
  nextId(prefix: string): string;
  now(): string;
};

export function createContext(baseUrl: string, store: MockStore): MockContext {
  let counter = 0;
  return {
    baseUrl,
    store,
    nextId: (prefix) => `${prefix}_mock_${String(++counter).padStart(4, "0")}`,
    now: () => new Date().toISOString(),
  };
}

export const errorResponse = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) => HttpResponse.json(fail(code, message, details), { status: ERROR_HTTP_STATUS[code] });

export const okResponse = <T>(data: T, status = 200) => HttpResponse.json(ok(data), { status });

export function pagedResponse<T>(items: readonly T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return HttpResponse.json(
    paged(items.slice(start, start + pageSize), { page, pageSize, total: items.length }),
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const queryOf = (request: Request): Record<string, string> =>
  Object.fromEntries(new URL(request.url).searchParams);

/** Same shape as the API's error handler: field errors from ZodError.flatten(). */
export function invalid(error: z.ZodError) {
  return errorResponse("VALIDATION_ERROR", "Some fields are invalid.", error.flatten().fieldErrors);
}

const bearer = (request: Request) =>
  request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;

/** Any signed-in, enabled staff member (e.g. for /admin/me), otherwise a 401 response. */
export function authenticate(ctx: MockContext, request: Request): MockUser | Response {
  const userId = userIdForToken(bearer(request));
  const caller = ctx.store.get().users.find((u) => u.user.id === userId);
  if (!caller || caller.disabled || !isAdminRole(caller.user.role)) {
    return errorResponse("UNAUTHENTICATED", "Your session has expired. Sign in again.");
  }
  return caller;
}

/**
 * The signed-in caller if they hold `permission`, otherwise the 401/403 response.
 * Access tokens are only issued after 2FA, so a valid token has passed it.
 */
export function authorize(
  ctx: MockContext,
  request: Request,
  permission: Permission,
): MockUser | Response {
  const caller = authenticate(ctx, request);
  if (caller instanceof Response) return caller;
  if (!can(caller.user.role, permission)) {
    return errorResponse("FORBIDDEN", "Your role doesn't allow this action.");
  }
  return caller;
}

type AuditInput = {
  actor: MockUser;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

/** A new database with the audit entry prepended (newest first). */
export function withAudit(ctx: MockContext, db: MockDb, input: AuditInput): MockDb {
  const entry: AuditLogEntry = {
    id: ctx.nextId("aud"),
    actorId: input.actor.user.id,
    actorEmail: input.actor.user.email,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
    ip: "127.0.0.1",
    createdAt: ctx.now(),
  };
  return { ...db, audit: [entry, ...db.audit] };
}

/** Immutable replace of the first item matching `id`. */
export function replaceById<T extends { id: string }>(items: readonly T[], next: T): T[] {
  return items.map((item) => (item.id === next.id ? next : item));
}
