"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AdminResetPasswordInput } from "@hp/contracts";
import { TextField } from "@/components/settings/shared";
import { useEndpoints } from "@/lib/store-settings";
import { errorMessage } from "@/lib/session";
import { AuthFrame } from "./AuthFrame";
import { tokenFromHash } from "./AcceptInviteForm";

const MISSING_TOKEN = "This reset link is incomplete. Open the link from your email again.";

/**
 * Staff choose a new password from the emailed link (token in the URL fragment, which is
 * read once and removed from the address bar). Admins never see or set the password.
 */
export function ResetPasswordForm() {
  const endpoints = useEndpoints();
  // undefined until the fragment has been read on the client.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(tokenFromHash(window.location.hash));
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!token) return;
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    const parsed = AdminResetPasswordInput.safeParse({ token, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your new password.");
      return;
    }
    try {
      await endpoints.adminAuth.resetPassword(parsed.data);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (token === undefined) {
    return (
      <AuthFrame step="Password reset" title="Choose a new password">
        <p role="status" className="text-sm text-muted">
          Reading your link…
        </p>
      </AuthFrame>
    );
  }

  if (done) {
    return (
      <AuthFrame step="Password reset" title="Your password is updated">
        <p className="text-sm text-muted">
          Sign in with your new password, then enter the code from your authenticator app.
        </p>
        <Link href="/login" className="btn btn-primary mt-6 inline-flex">
          Go to sign in
        </Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame step="Password reset" title="Choose a new password">
      {token === null ? (
        <p role="alert" className="error-text">
          {MISSING_TOKEN}
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField
            id="reset-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters."
            value={password}
            onChange={setPassword}
          />
          <TextField
            id="reset-confirm"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary">
            Set new password
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
