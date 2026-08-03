"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import {
  getInterfaceLanguageShortLabel,
  INTERFACE_LANGUAGE_OPTIONS,
  type Locale,
} from "@/lib/languages";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth-context";
import { updateMe } from "@/lib/api";
import { cn } from "@/lib/utils";

/** StarNexus-style language dropdown: Globe + short code + checklist. */
export function LanguageSwitcher({
  className,
  tone = "default",
}: {
  className?: string;
  tone?: "default" | "onDark";
}) {
  const { locale, setLocale, t } = useLocale();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const short = getInterfaceLanguageShortLabel(locale);
  const currentLabel =
    INTERFACE_LANGUAGE_OPTIONS.find((l) => l.code === locale)?.label ?? short;
  const onDark = tone === "onDark";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (code: Locale) => {
    setLocale(code);
    setOpen(false);
    if (user) {
      void updateMe({ locale: code }).catch(() => {
        /* best-effort server persistence */
      });
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group/lang inline-flex h-9 items-center gap-1 rounded-full px-2 transition-colors sm:px-2.5",
          onDark
            ? cn("text-white/70 hover:bg-white/10 hover:text-white", open && "bg-white/10 text-white")
            : cn("text-ink-muted hover:bg-surface-2 hover:text-ink", open && "bg-surface-2 text-ink"),
        )}
        aria-label={`${t("langSwitchHint")}, ${currentLabel}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={currentLabel}
      >
        <Globe
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-300 ease-out group-hover/lang:rotate-12",
            open && "rotate-12",
          )}
          aria-hidden
        />
        <span
          key={short}
          className={cn(
            "min-w-[1.375rem] text-center text-[11px] font-semibold tracking-wide tabular-nums",
            onDark ? "text-white" : "text-ink",
          )}
          aria-hidden
        >
          {short}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 opacity-50 transition-transform duration-300",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t("langSwitchHint")}
          className="absolute right-0 top-[calc(100%+0.35rem)] z-[80] min-w-[10.5rem] overflow-hidden rounded-xl border border-line bg-base py-1 shadow-lg"
        >
          {INTERFACE_LANGUAGE_OPTIONS.map((lang) => {
            const active = locale === lang.code;
            return (
              <li key={lang.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => pick(lang.code)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-body-sm transition-colors hover:bg-surface-2",
                    active ? "text-ink font-medium" : "text-ink-muted",
                  )}
                >
                  <span className="flex-1">{lang.label}</span>
                  <Check
                    className={cn("h-3.5 w-3.5 shrink-0", !active && "invisible")}
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
