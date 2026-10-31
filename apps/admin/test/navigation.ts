import { vi } from "vitest";

// A tiny stand-in for the App Router: push/replace record calls and update a
// subscribable URL (path + query) so tests can render "the current route".

type Listener = () => void;

let href = "/";
const listeners = new Set<Listener>();

function setPath(next: string): void {
  href = next;
  listeners.forEach((l) => l());
}

export const mockRouter = {
  push: vi.fn((href: string) => setPath(href)),
  replace: vi.fn((href: string) => setPath(href)),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export const navigation = {
  getPathname: (): string => href.split("?")[0] ?? "/",
  /** The query string without "?" (a stable string snapshot for useSyncExternalStore). */
  getSearch: (): string => href.split("?")[1] ?? "",
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset(path = "/"): void {
    href = path;
    listeners.clear();
    Object.values(mockRouter).forEach((fn) => fn.mockClear());
  },
};
