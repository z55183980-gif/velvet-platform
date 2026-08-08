"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, cn } from "@velvet/ui";
import { useI18n } from "@/lib/i18n";

export type WatermarkPlacement = {
  enabled: boolean;
  x: number;
  y: number;
  scale: number;
};

const DEFAULT_PLACEMENT: WatermarkPlacement = {
  enabled: false,
  x: 0.84,
  y: 0.84,
  scale: 0.12,
};

type Props = {
  /** First-frame preview URL (signed media or blob). */
  frameUrl: string | null;
  frameWidth?: number;
  frameHeight?: number;
  watermarkSrc?: string;
  value?: WatermarkPlacement;
  busy?: boolean;
  onChange?: (next: WatermarkPlacement) => void;
  className?: string;
};

/**
 * Toggle burn-in watermark + drag mark on first-frame preview.
 * Coordinates are top-left of watermark as fractions of the frame (0–1).
 */
export function WatermarkPositionEditor({
  frameUrl,
  frameWidth,
  frameHeight,
  watermarkSrc = "/brand/velvet-watermark.png",
  value,
  busy,
  onChange,
  className,
}: Props) {
  const { t } = useI18n();
  const [local, setLocal] = useState<WatermarkPlacement>(value || DEFAULT_PLACEMENT);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (value) setLocal(value);
  }, [value]);

  function commit(next: WatermarkPlacement) {
    setLocal(next);
    onChange?.(next);
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!local.enabled || busy || !frameUrl) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    moveTo(e.clientX, e.clientY);
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!dragging.current) return;
    moveTo(e.clientX, e.clientY);
  }

  function onPointerUp() {
    dragging.current = false;
  }

  function moveTo(clientX: number, clientY: number) {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const markW = local.scale;
    // Square-ish badge: height fraction = width_px / frameHeight = scale * (W/H)
    const aspect =
      frameWidth && frameHeight && frameHeight > 0 ? frameWidth / frameHeight : 16 / 9;
    const markH = markW * aspect;
    let x = (clientX - rect.left) / rect.width - markW / 2;
    let y = (clientY - rect.top) / rect.height - markH / 2;
    x = Math.min(1 - markW, Math.max(0, x));
    y = Math.min(1 - markH, Math.max(0, y));
    commit({ ...local, x, y });
  }

  const markStyle = {
    left: `${local.x * 100}%`,
    top: `${local.y * 100}%`,
    width: `${local.scale * 100}%`,
  };

  return (
    <div className={cn("space-y-3", className)}>
      <label className="flex items-center gap-2 text-body-sm text-ink">
        <input
          type="checkbox"
          checked={local.enabled}
          disabled={busy}
          onChange={(e) => commit({ ...local, enabled: e.target.checked })}
        />
        <span>{t("watermarkEnable")}</span>
      </label>

      {local.enabled ? (
        <>
          <p className="text-caption text-ink-muted">{t("watermarkPositionHint")}</p>
          <div
            ref={stageRef}
            className="relative aspect-video w-full cursor-crosshair overflow-hidden rounded-lg border border-line bg-surface-2 select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {frameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frameUrl} alt="" className="h-full w-full object-contain" draggable={false} />
            ) : (
              <div className="flex h-full items-center justify-center text-caption text-ink-muted">
                {t("watermarkNeedFrame")}
              </div>
            )}
            {frameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={watermarkSrc}
                alt=""
                className="pointer-events-none absolute shadow-sm"
                style={markStyle}
                draggable={false}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-caption text-ink-muted">
              {t("watermarkScale")}
              <Input
                className="mt-1 w-24"
                type="number"
                min={0.04}
                max={0.4}
                step={0.01}
                value={String(local.scale)}
                disabled={busy}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  commit({
                    ...local,
                    scale: Math.min(0.4, Math.max(0.04, n)),
                  });
                }}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !frameUrl}
              onClick={() => commit({ ...local, x: 0.84, y: 0.84, scale: 0.12 })}
            >
              {t("watermarkResetCorner")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export { DEFAULT_PLACEMENT };
