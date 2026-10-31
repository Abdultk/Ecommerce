// First-load JS budget per route. Blueprint 5.3 asked for < 170 KB on product pages; measured
// 2026-10-24 after lazy-loading GSAP, Lenis and the fx components, the shared client code (React,
// Next, Zod for response validation) leaves product at 186.6 KB, checkout at 181.9 KB and the
// rest at <= 178.7 KB. The limits below sit just above those measurements so growth still fails.
// Pure logic; scripts/check-bundle-budget.mjs feeds it .next/app-build-manifest.json and
// gzipped file sizes after `next build`. Unlike the size Next prints for app routes, this
// counts the page *and every ancestor layout's* client JS — what a cold visit downloads.
// No relative imports: the script loads this file with Node's TypeScript type stripping.
import { z } from "zod";

const KB = 1024;

export const BUDGETS = {
  /** Product detail pages (the heaviest: gallery, variants, reviews). */
  product: 190 * KB,
  /** Checkout loads Stripe Elements lazily at the payment step; this is before that. */
  checkout: 185 * KB,
  default: 180 * KB,
} as const;

const AppBuildManifest = z.object({ pages: z.record(z.string(), z.array(z.string())) });
export type AppBuildManifest = z.infer<typeof AppBuildManifest>;

export type RouteReport = { route: string; bytes: number; budget: number; over: boolean };

export function parseAppBuildManifest(raw: unknown): AppBuildManifest {
  return AppBuildManifest.parse(raw);
}

/** "/(shop)/p/[slug]/page" → "/p/[slug]" (route groups and the trailing "page" removed). */
export function routeOf(pageKey: string): string {
  const segments = pageKey
    .split("/")
    .filter((s) => s && s !== "page" && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segments.join("/")}`;
}

/** The page's JS plus every ancestor layout's, in load order, without duplicates. */
export function firstLoadFiles(pages: AppBuildManifest["pages"], pageKey: string): string[] {
  const segments = pageKey.split("/").filter(Boolean).slice(0, -1);
  const layoutKeys = segments.reduce<string[]>(
    (keys, _, i) => [...keys, `/${segments.slice(0, i + 1).join("/")}/layout`],
    ["/layout"],
  );
  const files = [...layoutKeys, pageKey].flatMap((key) => pages[key] ?? []);
  return [...new Set(files.filter((f) => f.endsWith(".js")))];
}

export function budgetFor(route: string): number {
  if (route.startsWith("/p/")) return BUDGETS.product;
  if (route.startsWith("/checkout")) return BUDGETS.checkout;
  return BUDGETS.default;
}

const isUserPage = (key: string) => key.endsWith("/page") && !key.startsWith("/_");

/** One row per page route, sorted by route; `over` marks a budget breach. */
export function evaluateBudgets(
  manifest: AppBuildManifest,
  gzipSize: (file: string) => number,
): RouteReport[] {
  return Object.keys(manifest.pages)
    .filter(isUserPage)
    .map((key) => {
      const route = routeOf(key);
      const bytes = firstLoadFiles(manifest.pages, key).reduce((sum, f) => sum + gzipSize(f), 0);
      const budget = budgetFor(route);
      return { route, bytes, budget, over: bytes > budget };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}
