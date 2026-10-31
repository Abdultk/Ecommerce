"use client";

import { toDataURL } from "qrcode";
import { useEffect, useState } from "react";

const QR_SIZE_PX = 192;

export function secretFrom(otpauthUrl: string | undefined): string | null {
  if (!otpauthUrl) return null;
  try {
    return new URL(otpauthUrl).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** QR code plus the manual setup key for a new authenticator, shown once during enrollment. */
export function EnrollmentPanel({ otpauthUrl }: { otpauthUrl: string | undefined }) {
  const secret = secretFrom(otpauthUrl);
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (!otpauthUrl) return;
    let cancelled = false;
    // Generated locally: the secret never goes to a third-party QR service.
    toDataURL(otpauthUrl, { width: QR_SIZE_PX, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopyStatus("Copied to clipboard.");
    } catch {
      setCopyStatus("Couldn't copy. Select the key and copy it manually.");
    }
  }

  return (
    <section
      aria-labelledby="enroll-title"
      className="mb-6 rounded-md border border-line bg-surface p-4"
    >
      <h2 id="enroll-title" className="text-sm font-semibold text-ink-950">
        Set up your authenticator
      </h2>
      <p className="mt-1 text-sm text-muted">
        Scan the code with your authenticator app, or enter the key by hand as a time-based, 6-digit
        code.
      </p>
      {qr && (
        // A data: URL from the local qrcode package; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qr}
          width={QR_SIZE_PX}
          height={QR_SIZE_PX}
          alt="QR code for your authenticator app"
          className="mx-auto mt-3 rounded border border-line bg-white p-1"
        />
      )}
      {qrFailed && (
        <p className="mt-3 text-sm text-muted">The QR code couldn't be drawn; use the key below.</p>
      )}
      {secret ? (
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 rounded border border-line bg-paper px-3 py-2 font-mono text-sm tracking-[0.12em] break-all text-ink-950 select-all">
            {secret}
          </code>
          <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
            Copy secret
          </button>
        </div>
      ) : (
        <p className="error-text mt-3">The setup key is missing. Open your invite link again.</p>
      )}
      <p aria-live="polite" className="mt-2 min-h-4 text-xs text-muted">
        {copyStatus}
      </p>
    </section>
  );
}
