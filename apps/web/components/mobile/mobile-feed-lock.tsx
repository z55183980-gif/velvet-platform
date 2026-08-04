"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type MobileFeedLockContextValue = {
  locked: boolean;
  setLocked: (locked: boolean) => void;
};

const MobileFeedLockContext = createContext<MobileFeedLockContextValue | null>(null);

/** Tracks when the mobile home vertical feed is mounted (locks app chrome scroll). */
export function MobileFeedLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLockedState] = useState(false);
  const setLocked = useCallback((next: boolean) => {
    setLockedState(next);
  }, []);
  const value = useMemo(() => ({ locked, setLocked }), [locked, setLocked]);
  return (
    <MobileFeedLockContext.Provider value={value}>{children}</MobileFeedLockContext.Provider>
  );
}

export function useMobileFeedLock() {
  const ctx = useContext(MobileFeedLockContext);
  if (!ctx) {
    throw new Error("useMobileFeedLock must be used within MobileFeedLockProvider");
  }
  return ctx;
}
