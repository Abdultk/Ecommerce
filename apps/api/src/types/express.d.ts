import type { AccessClaims } from "../modules/auth/tokens";

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` / `optionalAuth` from a verified access token. */
      user?: AccessClaims;
      /** End-user address for per-IP limits (see lib/client-address.ts); falls back to req.ip. */
      clientIp?: string;
      /** direct: no trusted token; forwarded: token + X-HP-Client-IP; internal: token only. */
      clientKind?: "direct" | "forwarded" | "internal";
    }
  }
}

export {};
