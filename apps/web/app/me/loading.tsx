export default function Loading() {
  return (
    <div className="mx-auto max-w-[800px] px-4 py-8 md:px-6 md:py-12">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 animate-pulse rounded-full bg-surface-2 md:h-20 md:w-20" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-28 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
      <div className="mt-8 h-14 animate-pulse rounded-2xl bg-surface-2" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-2xl bg-surface-2" />
        <div className="h-28 animate-pulse rounded-2xl bg-surface-2" />
      </div>
      <div className="mt-6 space-y-0 overflow-hidden rounded-2xl border border-line/40">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse border-t border-line/40 bg-surface-2/60 first:border-t-0"
          />
        ))}
      </div>
      <div className="mt-8 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
