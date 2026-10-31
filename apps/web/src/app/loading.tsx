export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skeleton mb-4 h-5 w-32" />
      <div className="skeleton mb-10 h-12 w-2/3" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton aspect-[4/5]" />
        ))}
      </div>
    </div>
  );
}
