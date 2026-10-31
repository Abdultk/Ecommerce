import { useId, type Ref, type SelectHTMLAttributes } from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  ref?: Ref<HTMLSelectElement>;
};

/** Labelled select whose error is linked with aria-describedby (mirrors TextField). */
export function SelectField({ label, name, options, placeholder, error, ref, ...rest }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <select
        ref={ref}
        id={id}
        name={name}
        className="field"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
