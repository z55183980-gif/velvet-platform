export default function Loading() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-6 md:px-10 md:pt-10">
      <div className="flex gap-4 md:gap-9">
        <div className="h-[138px] w-[98px] shrink-0 animate-pulse rounded-xl bg-white/[0.06] md:h-[238px] md:w-[168px] md:rounded-2xl" />
        <div className="flex-1 space-y-3 pt-1">
          <div className="h-7 w-2/3 animate-pulse rounded bg-white/[0.06]" />
          <div className="flex gap-2">
            <div className="h-7 w-16 animate-pulse rounded-md bg-white/[0.06]" />
            <div className="h-7 w-20 animate-pulse rounded-md bg-white/[0.06]" />
            <div className="h-7 w-14 animate-pulse rounded-md bg-white/[0.06]" />
          </div>
          <div className="mt-6 hidden h-[45px] w-[162px] animate-pulse rounded-xl bg-white/[0.06] md:block" />
        </div>
      </div>
      <div className="mt-8 space-y-3">
        <div className="h-5 w-24 animate-pulse rounded bg-white/[0.06]" />
        <div className="h-16 w-full animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-6 flex gap-2 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[52px] w-[53px] shrink-0 animate-pulse rounded-lg bg-white/[0.06]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
