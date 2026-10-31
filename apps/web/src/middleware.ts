import { NextResponse, type NextRequest } from "next/server";
import { API_URL, CDN_URL, IS_PRODUCTION } from "@/lib/env";
import { buildCsp, createNonce } from "@/lib/security-headers";

/**
 * Per-request nonce CSP. Next reads the nonce from the request's CSP header and applies it
 * to its own scripts; server components read `x-nonce` for JSON-LD. This makes every page
 * render per request (no static HTML); catalog data stays cached in the fetch cache.
 */
export function middleware(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    apiUrl: API_URL,
    cdnUrl: CDN_URL,
    isDev: process.env.NODE_ENV === "development",
    isProduction: IS_PRODUCTION,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Static assets, images, and metadata files carry no inline scripts.
      source:
        "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
