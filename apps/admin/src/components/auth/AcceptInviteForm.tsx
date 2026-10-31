"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@hp/contracts";
import { errorMessage, useSession } from "@/lib/session";
import { AuthFrame } from "./AuthFrame";

const MISSING_TOKEN =
  "This invite link is incomplete. Open the link from your invite email again, or ask a super admin to resend it.";

/** Reads `token` from a `#token=…` fragment; fragments never reach servers or their logs. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && token.trim() !== "" ? token.trim() : null;
}

/**
 * Step 1 of staff enrollment: the emailed link carries a single-use token in the URL
 * fragment. The token is read once and removed from the address bar (and history), then
 * the new password is set and the 2FA step shows the authenticator QR code.
 */
export function AcceptInviteForm() {
  const { acceptInvite } = useSession();
  const router = useRouter();
  // undefined until the fragment has been read on the client.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setToken(tokenFromHash(window.location.hash));
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("The passwords don't match.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await acceptInvite({ token, password });
      router.push("/login/2fa");
    } catch (err) {
      setError(errorMessage(err));
      setIsSubmitting(false);
    }
  }

  if (token === undefined) {
    return (
      <AuthFrame step="Invitation" title="Set up your admin account">
        <p role="status" className="text-sm text-muted">
          Reading your invite…
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame step="Step 1 of 2 · Invitation" title="Set up your admin account">
      {token === null ? (
        <p role="alert" className="error-text">
          {MISSING_TOKEN}
        </p>
      ) : (
        <form method="post" noValidate onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted">
            Choose a password, then add PAISLEY art to your authenticator app. The link works
            once.
          </p>
          <div>
            <label htmlFor="new-password" className="field-label">
              New password
            </label>
            <input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
              aria-describedby="password-hint"
              className="field"
            />
            <p id="password-hint" className="mt-1 text-xs text-muted">
              At least {PASSWORD_MIN_LENGTH} characters. A short sentence works well.
            </p>
          </div>
          <div>
            <label htmlFor="confirm-password" className="field-label">
              Confirm password
            </label>
            <input
              id="confirm-password"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className="field"
            />
          </div>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Set password"}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
