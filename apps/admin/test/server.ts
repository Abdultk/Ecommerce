import { setupServer } from "msw/node";

export const API = "http://localhost:4000/api/v1";

/** Handlers are installed per test in setup.ts so mock state never leaks between tests. */
export const server = setupServer();
