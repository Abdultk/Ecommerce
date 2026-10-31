"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  number: number;
  title: string;
  /** "current" renders children (and takes focus); "done" shows the summary; "todo" is muted. */
  state: "current" | "done" | "todo";
  focusOnActivate: boolean;
  summary?: ReactNode;
  onEdit?: () => void;
  editLabel?: string;
  children?: ReactNode;
};

/** One checkout step. Focus moves to its heading when it becomes current (WCAG 2.4.3). */
export function StepSection({
  number,
  title,
  state,
  focusOnActivate,
  summary,
  onEdit,
  editLabel,
  children,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state === "current" && focusOnActivate) heading.current?.focus();
  }, [state, focusOnActivate]);

  const muted = state === "todo" ? "opacity-70" : "";
  return (
    <section
      aria-labelledby={`step-${number}`}
      aria-current={state === "current" ? "step" : undefined}
      className={`rounded-[var(--radius-pan)] bg-crust p-5 shadow-[var(--shadow-plate)] sm:p-7 ${muted}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`step-${number}`}
          ref={heading}
          tabIndex={-1}
          className="flex items-center gap-3 text-2xl focus:outline-none"
        >
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-full bg-iron font-sans text-sm text-crust"
          >
            {number}
          </span>
          {title}
        </h2>
        {state === "done" && onEdit ? (
          <button type="button" className="btn btn-ghost py-1" onClick={onEdit}>
            {editLabel}
          </button>
        ) : null}
      </div>
      {state === "done" && summary ? (
        <div className="mt-3 text-sm text-smoke">{summary}</div>
      ) : null}
      {state === "current" ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}
