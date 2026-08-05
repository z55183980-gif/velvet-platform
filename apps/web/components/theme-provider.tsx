"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark";

type ThemeCtx = {
  theme: ThemeMode;
  resolved: ThemeMode;
  /** False until client has applied the stored preference. */
  ready: boolean;
  setTheme: (t: ThemeMode) => void;
  cycleTheme: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = "dv_theme";
const DEFAULT_THEME: ThemeMode = "dark";

function applyDom(resolved: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;
}

function readStoredTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

function subscribeTheme(onStoreChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("dv-theme", onStoreChange as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("dv-theme", onStoreChange as EventListener);
  };
}

function emitThemeChange() {
  window.dispatchEvent(new Event("dv-theme"));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // During SSR + hydration, React uses getServerSnapshot ("dark") so markup matches.
  // After hydration, getSnapshot reads localStorage without a hydration warning.
  const stored = useSyncExternalStore(subscribeTheme, readStoredTheme, () => DEFAULT_THEME);
  const [override, setOverride] = useState<ThemeMode | null>(null);
  const [ready, setReady] = useState(false);
  const theme = override ?? stored;

  useEffect(() => {
    setReady(true);
    applyDom(theme);
  }, [theme]);

  const setTheme = useCallback((t: ThemeMode) => {
    setOverride(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
    applyDom(t);
    emitThemeChange();
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return (
    <Ctx.Provider value={{ theme, resolved: theme, ready, setTheme, cycleTheme }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
