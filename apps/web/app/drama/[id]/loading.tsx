export default function Loading() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-10">
      <div className="flex flex-col gap-6 md:flex-row md:gap-10">
        <div className="aspect-[2/3] w-full max-w-[280px] animate-pulse rounded-lg bg-surface-2" />
        <div className="flex-1 space-y-4 pt-2">
          <div className="h-8 w-2/3 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="h-24 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-10 w-40 animate-pulse rounded-full bg-surface-2" />
          <div className="mt-8 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
