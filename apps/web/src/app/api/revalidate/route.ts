import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/revalidate
 *
 * Called by the Express API (apps/api/src/lib/revalidate.ts) after every admin
 * mutation. Purges the matching Next.js Data Cache tag so the next visitor gets
 * fresh data without a full redeploy.
 *
 * Security: a shared REVALIDATE_SECRET (server-only env var, never NEXT_PUBLIC_)
 * is checked on every request. A missing or wrong secret gets a 401.
 */

const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Reject immediately if the secret isn't configured — this prevents silent
  // misconfigurations where every request is accepted in production.
  if (!REVALIDATE_SECRET) {
    return NextResponse.json(
      { error: "Revalidation is not configured on this server." },
      { status: 503 },
    );
  }

  const incomingSecret = req.headers.get("x-revalidate-secret");
  if (!incomingSecret || incomingSecret !== REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let tag: string;
  try {
    const body = (await req.json()) as unknown;
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>)["tag"] !== "string"
    ) {
      return NextResponse.json(
        { error: "Body must be JSON with a string 'tag' field." },
        { status: 400 },
      );
    }
    tag = (body as { tag: string }).tag;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  revalidateTag(tag);

  return NextResponse.json({ revalidated: true, tag });
}
