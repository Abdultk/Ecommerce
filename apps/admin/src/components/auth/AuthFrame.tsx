import Image from "next/image";
import type { ReactNode } from "react";

type AuthFrameProps = {
  step: string;
  title: string;
  children: ReactNode;
};

/** Shared two-panel frame for the sign-in steps: brand and a store photo on the left, the form on the right. */
export function AuthFrame({ step, title, children }: AuthFrameProps) {
  return (
    <div className="grid min-h-dvh bg-paper md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-ink-950 md:block">
        <Image
          src="/login-photo.jpg"
          alt=""
          fill
          priority
          sizes="42vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-ink-950/72" aria-hidden="true" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Image
            src="/logo-inline.png"
            alt="PAISLEY art"
            width={873}
            height={239}
            priority
            className="h-24 w-auto self-start"
          />
          <div className="max-w-sm">
            <p className="font-display text-4xl leading-tight text-white">
              Run the store from here.
            </p>
            <p className="mt-4 text-ink-200">
              For store staff only. Every sign-in needs your password and a code from your
              authenticator app.
            </p>
          </div>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <Image
            src="/logo-inline.png"
            alt="PAISLEY art"
            width={873}
            height={239}
            priority
            className="mb-10 h-14 w-auto md:hidden"
          />
          <p className="text-sm text-muted">{step}</p>
          <h1 className="mt-2 font-display text-3xl leading-tight text-ink-950">{title}</h1>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
