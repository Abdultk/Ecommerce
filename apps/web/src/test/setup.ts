import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { navigationMock } from "./navigation";

// Components that read the router (search, mobile menu, quick add, nav) work in any test.
// A test file can still call vi.mock("next/navigation", ...) itself to override this default.
vi.mock("next/navigation", () => navigationMock());

// jsdom has no matchMedia; the motion components ask for prefers-reduced-motion. "No match"
// means motion allowed, and the components only use it to decide whether to animate.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
