import { useId, type InputHTMLAttributes, type Ref } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  ref?: Ref<HTMLInputElement>;
};

/** Labelled input whose error and hint are linked with aria-describedby. */
export function TextField({ label, name, error, hint, ref, ...inputProps }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        name={name}
        className="field"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-smoke">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
