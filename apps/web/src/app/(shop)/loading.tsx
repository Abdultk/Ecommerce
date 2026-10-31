export default function ShopLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading products…</span>
      <div className="skeleton mb-4 h-5 w-28" />
      <div className="skeleton mb-10 h-12 w-1/2" />
      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        <div className="hidden space-y-4 md:block">
          <div className="skeleton h-28" />
          <div className="skeleton h-48" />
          <div className="skeleton h-40" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton aspect-[4/5]" />
          ))}
        </div>
      </div>
    </div>
  );
}
