"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  adminLogout as apiLogout,
  adminMe,
  clearAdminToken,
  getAdminToken,
  type AdminProfile,
} from "@velvet/api-client";

type SessionState = {
  admin: AdminProfile | null;
  ready: boolean;
  refreshing: boolean;
};

let memoryAdmin: AdminProfile | null = null;

type AdminSessionContextValue = SessionState & {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminProfile | null>(memoryAdmin);
  const [ready, setReady] = useState(!!memoryAdmin);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      memoryAdmin = null;
      setAdmin(null);
      setReady(true);
      router.replace("/login");
      return;
    }
    setRefreshing(true);
    try {
      const me = await adminMe();
      memoryAdmin = me;
      setAdmin(me);
      setReady(true);
    } catch {
      memoryAdmin = null;
      setAdmin(null);
      clearAdminToken();
      setReady(true);
      router.replace("/login");
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout();
    memoryAdmin = null;
    setAdmin(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo(
    () => ({ admin, ready, refreshing, refresh, logout }),
    [admin, ready, refreshing, refresh, logout],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession must be used within AdminSessionProvider");
  return ctx;
}
