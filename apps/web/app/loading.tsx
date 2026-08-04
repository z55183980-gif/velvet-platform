export default function Loading() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-10">
      <div className="mb-8 h-8 w-48 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
