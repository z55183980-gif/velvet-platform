"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark";

type ThemeCtx = {
  theme: ThemeMode;
  resolved: ThemeMode;
  /** False until localStorage theme is applied — keep SSR/client first paint aligned. */
  ready: boolean;
  setTheme: (t: ThemeMode) => void;
  cycleTheme: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = "dv_theme";

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
    // Migrate legacy "system" to dark
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR + first client render must match (default dark). Load preference after mount.
  const [theme, setThemeState] = useState<ThemeMode>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readStoredTheme();
    setThemeState(next);
    applyDom(next);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyDom(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, ready]);

  const setTheme = useCallback((t: ThemeMode) => setThemeState(t), []);
  const cycleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

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
