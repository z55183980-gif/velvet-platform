/** Shared PC Hero crop params — keep admin preview in sync with web Hero. */
export const HERO_CROP = {
  /** Desktop focal frame ≈ 74vw × 94vh on 16:9 → ~1.4 */
  aspectClass: "aspect-[7/5]",
  defaultFocusX: 50,
  defaultFocusY: 22,
  softMaskClass:
    "[mask-image:radial-gradient(ellipse_68%_78%_at_58%_40%,#000_22%,transparent_72%)] [-webkit-mask-image:radial-gradient(ellipse_68%_78%_at_58%_40%,#000_22%,transparent_72%)]",
} as const;

export function clampFocus(n: unknown, fallback: number) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(0, v));
}

export function heroObjectPosition(focusX?: number | null, focusY?: number | null) {
  const x = clampFocus(focusX, HERO_CROP.defaultFocusX);
  const y = clampFocus(focusY, HERO_CROP.defaultFocusY);
  return `${x}% ${y}%`;
}
