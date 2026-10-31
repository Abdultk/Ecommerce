import { useId } from "react";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Top-level keys that differ between two snapshots (added, removed or changed). */
export function diffKeys(before: unknown, after: unknown): string[] {
  const left = isRecord(before) ? before : before === null ? {} : null;
  const right = isRecord(after) ? after : after === null ? {} : null;
  if (!left || !right) return same(before, after) ? [] : ["(value)"];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.filter((k) => !same(left[k], right[k]));
}

const pretty = (value: unknown) =>
  value === null || value === undefined ? "—" : JSON.stringify(value, null, 2);

/** Simple side-by-side JSON view of an audit entry's before/after snapshots. */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const ids = useId();
  const changed = diffKeys(before, after);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-800">
        {changed.length > 0 ? `Changed: ${changed.join(", ")}` : "No differences recorded."}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {(
          [
            ["Before", before],
            ["After", after],
          ] as const
        ).map(([label, value]) => (
          <section
            key={label}
            role="region"
            aria-labelledby={`${ids}-${label}`}
            className="min-w-0"
          >
            <h3 id={`${ids}-${label}`} className="eyebrow mb-1 text-muted">
              {label}
            </h3>
            <pre className="max-h-96 overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-xs leading-relaxed text-ink-950">
              {pretty(value)}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}
