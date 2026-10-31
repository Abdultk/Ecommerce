import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
};

export function PageHeader({ title, eyebrow, description }: PageHeaderProps) {
  return (
    <header className="mb-6">
      {eyebrow && <p className="eyebrow text-ember-700">{eyebrow}</p>}
      <h1 className="mt-0.5 font-display text-[1.75rem] leading-tight text-ink-950">{title}</h1>
      {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
    </header>
  );
}
