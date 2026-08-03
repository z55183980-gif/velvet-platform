import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** Icon box size in px */
  size?: number;
  /** Show "Velvet" wordmark beside the mark */
  withWordmark?: boolean;
  /** Force light wordmark (for dark/overlay headers) */
  onDark?: boolean;
  /** Prefetch for LCP (navbar) */
  priority?: boolean;
  className?: string;
  wordmarkClassName?: string;
};

/** Global Velvet brand mark (transparent PNG). */
export function BrandLogo({
  size = 32,
  withWordmark = true,
  onDark = false,
  priority = false,
  className,
  wordmarkClassName,
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image
        src="/logo.png"
        alt="Velvet"
        width={size}
        height={size}
        priority={priority}
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
      {withWordmark ? (
        <span
          className={cn(
            "text-h3 font-bold tracking-tight md:text-h4",
            onDark ? "text-white" : "text-ink",
            wordmarkClassName,
          )}
        >
          Velvet
        </span>
      ) : null}
    </span>
  );
}
