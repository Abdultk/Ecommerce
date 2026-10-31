import { vi } from "vitest";

/** Shared spies for the next/navigation mock; call vi.mock("next/navigation", ...) with navigationMock. */
export const routerSpies = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

export const navigationMock = () => ({
  useRouter: () => routerSpies,
  usePathname: () => "/shop",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
});
