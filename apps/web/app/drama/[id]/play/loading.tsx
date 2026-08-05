/** Soft-nav placeholder for /drama/[id]/play — blank watch stage. */
export default function Loading() {
  return <div className="fixed inset-0 z-[70] bg-black" aria-busy="true" />;
}
