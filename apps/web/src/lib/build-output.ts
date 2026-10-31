// Strings that only exist in test mock code (src/test/msw, @hp/test-utils). scripts/check-bundle-budget.mjs scans
// .next/static and .next/server for them after `next build` and fails on any hit.
// No relative imports: the script loads this file with Node's TypeScript type stripping.

export const MOCK_MARKERS = [
  { text: "INTEGRITY_CHECKSUM", what: "the MSW service worker script" },
  { text: "mock-access-", what: "mock API auth handlers (src/test/msw)" },
  { text: "expired-token-0000000000", what: "mock API auth handlers (src/test/msw)" },
  { text: "u_mock_0001", what: "mock API seed data (src/test/msw)" },
  { text: "p_sample_01", what: "the sample catalog (@hp/test-utils)" },
] as const;

/** One message per distinct artefact found in `source`. */
export function findMockLeaks(file: string, source: string): string[] {
  const found = MOCK_MARKERS.filter((m) => source.includes(m.text)).map((m) => m.what);
  return [...new Set(found)].map((what) => `${file}: contains ${what}`);
}

/** Strings that must never reach a browser chunk (.next/static); servers legitimately use them. */
export const CLIENT_FORBIDDEN = [
  { text: "X-Internal-Token", what: "the internal API token header (server-only)" },
  { text: "INTERNAL_API_TOKEN", what: "the internal API token variable (server-only)" },
] as const;

export function findClientSecrets(file: string, source: string): string[] {
  return CLIENT_FORBIDDEN.filter((m) => source.includes(m.text)).map(
    (m) => `${file}: contains ${m.what}`,
  );
}
