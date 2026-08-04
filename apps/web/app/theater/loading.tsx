export default function Loading() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6 h-9 w-40 animate-pulse rounded bg-surface-2" />
      <div className="mb-6 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-16 shrink-0 animate-pulse rounded-full bg-surface-2" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-4 md:gap-5 lg:grid-cols-5 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
