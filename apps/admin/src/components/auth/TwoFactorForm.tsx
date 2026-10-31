"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorMessage, useSession } from "@/lib/session";
import { AuthFrame } from "./AuthFrame";
import { EnrollmentPanel } from "./EnrollmentPanel";

export function TwoFactorForm() {
  const { challenge, status, verifyCode } = useSession();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // After a successful verify the challenge is cleared too; don't bounce a signed-in user.
    if (!challenge && status !== "authenticated") router.replace("/login");
  }, [challenge, status, router]);

  if (!challenge) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await verifyCode(code.trim());
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  }

  return (
    <AuthFrame
      step={challenge.enrollmentRequired ? "Step 2 of 2 · Enrollment" : "Step 2 of 2"}
      title="Enter your verification code"
    >
      {challenge.enrollmentRequired && <EnrollmentPanel otpauthUrl={challenge.otpauthUrl} />}
      <form method="post" noValidate onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="totp" className="field-label">
            6-digit code
          </label>
          <input
            ref={inputRef}
            id="totp"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
            aria-describedby={error ? "totp-error totp-hint" : "totp-hint"}
            aria-invalid={error ? true : undefined}
            className="field font-mono text-lg tracking-[0.4em]"
          />
          <p id="totp-hint" className="mt-1 text-xs text-muted">
            From your authenticator app. Codes change every 30 seconds.
          </p>
        </div>
        {error && (
          <p id="totp-error" role="alert" className="error-text">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? "Verifying…" : "Verify and sign in"}
        </button>
        <button
          type="button"
          className="btn btn-link w-full"
          onClick={() => router.replace("/login")}
        >
          Use a different account
        </button>
      </form>
    </AuthFrame>
  );
}
