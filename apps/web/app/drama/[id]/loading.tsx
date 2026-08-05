/**
 * Soft-nav placeholder for /drama/[id].
 * Prefer a neutral dark stage: watch entries stay black-ready; browse (?browse=1) is close to #1c1c1c.
 */
export default function Loading() {
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-[#1c1c1c] md:hidden" aria-busy="true" />
      <div className="mx-auto hidden max-w-[1280px] px-4 pb-24 pt-6 md:block md:px-10 md:pt-10">
        <div className="flex gap-9">
          <div className="h-[238px] w-[168px] shrink-0 animate-pulse rounded-2xl bg-white/[0.06]" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="h-7 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            <div className="flex gap-2">
              <div className="h-7 w-16 animate-pulse rounded-md bg-white/[0.06]" />
              <div className="h-7 w-20 animate-pulse rounded-md bg-white/[0.06]" />
              <div className="h-7 w-14 animate-pulse rounded-md bg-white/[0.06]" />
            </div>
            <div className="mt-6 h-[45px] w-[162px] animate-pulse rounded-xl bg-white/[0.06]" />
          </div>
        </div>
        <div className="mt-8 space-y-3">
          <div className="h-5 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-16 w-full animate-pulse rounded bg-white/[0.06]" />
        </div>
      </div>
    </>
  );
}
