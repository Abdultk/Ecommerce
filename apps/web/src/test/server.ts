import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { API_URL } from "@/lib/env";
import { createAppMockHandlers } from "@/test/msw/handlers";

export const server = setupServer();

/** Starts MSW for the file; each test gets a fresh handler set (and so an empty mock cart). */
export function setupMockApi(): void {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  beforeEach(() => server.resetHandlers(...createAppMockHandlers(API_URL)));
  afterAll(() => server.close());
}

export { API_URL };
