"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError } from "@hp/api-client";
import { errorMessage, useSession, type SignOutReason } from "@/lib/session";
import { AuthFrame } from "./AuthFrame";

const GENERIC_CREDENTIALS_ERROR = "Email or password is incorrect.";

const REASON_NOTICES: Record<SignOutReason, string> = {
  manual: "You've signed out.",
  idle: "You were signed out after 30 minutes without activity.",
  expired: "Your session ended. Sign in again to continue.",
};

function loginErrorMessage(error: unknown): string {
  // Never reveal whether the email exists: every credential failure reads the same.
  if (error instanceof ApiClientError && error.code === "UNAUTHENTICATED")
    return GENERIC_CREDENTIALS_ERROR;
  return errorMessage(error);
}

export function LoginForm() {
  const { startLogin, signOutReason } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setIsSubmitting(true);
    try {
      await startLogin({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      router.push("/login/2fa");
    } catch (err) {
      setError(loginErrorMessage(err));
      setIsSubmitting(false);
    }
  }

  return (
    <AuthFrame step="Step 1 of 2" title="Sign in to the admin">
      {signOutReason && !error && (
        <p role="status" className="notice mb-5">
          {REASON_NOTICES[signOutReason]}
        </p>
      )}
      <form
        method="post"
        noValidate
        onSubmit={handleSubmit}
        className="space-y-5"
        aria-describedby={error ? "login-error" : undefined}
      >
        <div>
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            className="field min-h-11"
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <button
              type="button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
              className="-my-3.5 flex min-h-11 min-w-11 items-center justify-end text-xs font-medium text-ember-700 hover:underline"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="field min-h-11"
          />
        </div>
        {error && (
          <p id="login-error" role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary min-h-11 w-full" disabled={isSubmitting}>
          {isSubmitting ? "Checking…" : "Continue"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Forgot your password? Ask a super admin to send you a reset link.
      </p>
    </AuthFrame>
  );
}
