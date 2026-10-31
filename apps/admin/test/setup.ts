import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { createElement, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { createAdminMockHandlers } from "@test/mocks/handlers";
import { mockRouter, navigation } from "./navigation";
import { API, server } from "./server";

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => useSyncExternalStore(navigation.subscribe, navigation.getPathname),
  useSearchParams: () => {
    const search = useSyncExternalStore(navigation.subscribe, navigation.getSearch);
    return useMemo(() => new URLSearchParams(search), [search]);
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

// findBy*/waitFor default to 1 s, too short when parallel agents load the CPU.
configure({ asyncUtilTimeout: 5_000 });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  navigation.reset("/");
  // Fresh mock state (challenges, sessions) for every test.
  server.resetHandlers(...createAdminMockHandlers(API));
});
afterEach(() => cleanup());
afterAll(() => server.close());
