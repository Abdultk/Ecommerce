import { NextResponse, type NextRequest } from "next/server";
import { API_URL, CDN_URL, UPLOAD_ORIGIN } from "@/lib/config";
import { buildCsp } from "@/lib/security-headers";

/** Per-request nonce CSP. Next reads the nonce from the request header and applies it to its scripts. */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    apiUrl: API_URL,
    nonce,
    isDev: process.env.NODE_ENV === "development",
    cdnUrl: CDN_URL,
    uploadOrigin: UPLOAD_ORIGIN,
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
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
