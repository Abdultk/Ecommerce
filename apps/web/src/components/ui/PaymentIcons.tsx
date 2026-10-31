import type { SVGProps } from "react";

type BadgeProps = SVGProps<SVGSVGElement>;

export function VisaBadge(props: BadgeProps) {
  return (
    <svg
      viewBox="0 0 38 24"
      width="38"
      height="24"
      role="img"
      aria-label="Visa"
      className="h-6 w-auto rounded border border-white/10 bg-white/5 p-1 transition-opacity hover:opacity-90"
      {...props}
    >
      <rect width="38" height="24" rx="3" fill="#1434CB" />
      <path
        d="M15.4 17.5h-2.3l1.5-9h2.3l-1.5 9zm7.3-8.8c-.5-.2-1.2-.4-2.1-.4-2.3 0-4 1.2-4 3 0 1.3 1.2 2 2.1 2.4.9.4 1.2.7 1.2 1.1 0 .6-.7.9-1.4.9-1 0-1.5-.1-2.3-.5l-.3-.2-.3 1.9c.5.2 1.5.4 2.6.4 2.5 0 4.1-1.2 4.1-3.1 0-1-.6-1.8-2-2.5-.8-.4-1.3-.7-1.3-1.1 0-.4.4-.8 1.3-.8.7 0 1.3.1 1.7.3l.2.1.2-2zm5.7 3.5l1.2-3.3.7 3.3h-1.9zm2.9 5.3h2l-1.8-9h-1.9c-.6 0-1 .2-1.3.9l-3.6 8.1h2.4l.5-1.3h3l.7 1.3zm-14.7-9l-2.2 6.1-.2-1.2c-.4-1.4-1.6-2.9-3-3.6l1.9 7.7h2.4l3.6-9h-2.5z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function MastercardBadge(props: BadgeProps) {
  return (
    <svg
      viewBox="0 0 38 24"
      width="38"
      height="24"
      role="img"
      aria-label="Mastercard"
      className="h-6 w-auto rounded border border-white/10 bg-white/5 p-1 transition-opacity hover:opacity-90"
      {...props}
    >
      <rect width="38" height="24" rx="3" fill="#222325" />
      <circle cx="15" cy="12" r="7" fill="#EB001B" />
      <circle cx="23" cy="12" r="7" fill="#F79E1B" fillOpacity="0.8" />
    </svg>
  );
}

export function ApplePayBadge(props: BadgeProps) {
  return (
    <svg
      viewBox="0 0 38 24"
      width="38"
      height="24"
      role="img"
      aria-label="Apple Pay"
      className="h-6 w-auto rounded border border-white/10 bg-white/5 p-1 transition-opacity hover:opacity-90"
      {...props}
    >
      <rect width="38" height="24" rx="3" fill="#FFFFFF" />
      <path
        d="M13.2 12.3c0-1.4.9-2.5 2.1-3-.6-.8-1.5-1.3-2.5-1.3-1.1 0-2.1.6-2.6.6-.5 0-1.4-.6-2.3-.6-1.2 0-2.3.7-2.9 1.8-1.3 2.2-.3 5.5.9 7.3.6.9 1.3 1.8 2.2 1.8.9 0 1.2-.6 2.3-.6 1.1 0 1.4.6 2.3.6 1 0 1.6-.9 2.2-1.7.7-1 1-2 1-2.1-.1 0-1.9-.7-1.9-2.9zm-1.5-5.3c.5-.6.8-1.4.7-2.2-.7 0-1.6.5-2.1 1.1-.4.5-.8 1.3-.7 2.1.8.1 1.6-.4 2.1-1z"
        fill="#000000"
      />
      <path
        d="M18.8 8.1h2.8c1.6 0 2.7 1 2.7 2.5 0 1.6-1.1 2.6-2.7 2.6h-1.4v3.2h-1.4V8.1zm1.4 3.9h1.3c.8 0 1.4-.5 1.4-1.4s-.6-1.4-1.4-1.4h-1.3V12zm6.2 4.4c0-.7.6-1.2 1.4-1.2.8 0 1.4.4 1.7.8v-.7c0-.8-.6-1.3-1.6-1.3-.6 0-1.2.2-1.5.5l-.5-.8c.5-.4 1.3-.7 2.2-.7 1.7 0 2.7.9 2.7 2.5v3.3h-1.3v-.7c-.4.5-.9.8-1.7.8-1 0-1.8-.7-1.8-1.6zm3.1-.7v-.4c-.3-.3-.8-.5-1.3-.5-.6 0-1 .3-1 .8 0 .5.4.8 1 .8.8 0 1.3-.3 1.3-.7zm4.2 3.6l1.2-3.8-2-5.4h1.5l1.3 3.8 1.2-3.8h1.4l-2.9 7.4c-.4 1-1 1.8-2 1.8h-.7v-1.1c.2.1.4.1.7.1.6 0 .9-.3 1.1-.9z"
        fill="#000000"
      />
    </svg>
  );
}

/** A plain text label: Amwal Pay is named, but no logo is imitated. */
export function AmwalPayBadge(props: BadgeProps) {
  return (
    <svg
      viewBox="0 0 64 24"
      width="64"
      height="24"
      role="img"
      aria-label="Amwal Pay"
      className="h-6 w-auto rounded border border-white/10 bg-white/5 p-1 transition-opacity hover:opacity-90"
      {...props}
    >
      <rect width="64" height="24" rx="3" fill="#243B30" />
      <text
        x="32"
        y="16"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontSize="10"
        fontWeight="600"
        fill="#F6E7B8"
      >
        Amwal Pay
      </text>
    </svg>
  );
}

export function BankTransferBadge(props: BadgeProps) {
  return (
    <svg
      viewBox="0 0 38 24"
      width="38"
      height="24"
      role="img"
      aria-label="Bank Transfer"
      className="h-6 w-auto rounded border border-white/10 bg-white/5 p-1 transition-opacity hover:opacity-90"
      {...props}
    >
      <rect width="38" height="24" rx="3" fill="#243B30" />
      <path
        d="M19 7l8 4v1H11v-1l8-4zm-6 6h2v4h-2v-4zm5 0h2v4h-2v-4zm5 0h2v4h-2v-4zm-8 5h14v1.5H15V18z"
        fill="#F6E7B8"
      />
    </svg>
  );
}

export function PaymentIcons({ className }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <VisaBadge />
      <MastercardBadge />
      <ApplePayBadge />
      <AmwalPayBadge />
      <BankTransferBadge />
    </div>
  );
}
