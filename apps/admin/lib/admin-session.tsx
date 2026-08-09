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
import { useQueryClient } from "@tanstack/react-query";
import {
  ADMIN_TOKEN_KEY,
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
  const queryClient = useQueryClient();
  const [admin, setAdmin] = useState<AdminProfile | null>(memoryAdmin);
  const [ready, setReady] = useState(!!memoryAdmin);
  const [refreshing, setRefreshing] = useState(false);

  const clearCachedQueries = useCallback(() => {
    // Prevent lower-priv admins from seeing prior high-priv QueryClient data (30s staleTime).
    queryClient.clear();
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const tokenAtStart = getAdminToken();
    if (!tokenAtStart) {
      memoryAdmin = null;
      setAdmin(null);
      clearCachedQueries();
      setReady(true);
      router.replace("/login");
      return;
    }
    setRefreshing(true);
    try {
      const me = await adminMe();
      // Late response must not overwrite a newer login/logout.
      if (getAdminToken() !== tokenAtStart) return;
      // Identity change (or re-login): drop cached privileged queries.
      if (!memoryAdmin || memoryAdmin.id !== me.id || memoryAdmin.role !== me.role) {
        clearCachedQueries();
      }
      memoryAdmin = me;
      setAdmin(me);
      setReady(true);
    } catch {
      // Late failure must not clear a token that changed while this request was in flight.
      if (getAdminToken() !== tokenAtStart) return;
      memoryAdmin = null;
      setAdmin(null);
      clearAdminToken();
      clearCachedQueries();
      setReady(true);
      router.replace("/login");
    } finally {
      setRefreshing(false);
    }
  }, [router, clearCachedQueries]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cross-tab logout/login: drop privileged QueryClient cache when token changes.
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== ADMIN_TOKEN_KEY) return;
      memoryAdmin = null;
      setAdmin(null);
      clearCachedQueries();
      if (!ev.newValue) {
        setReady(true);
        router.replace("/login");
        return;
      }
      void refresh();
    };
    const bc =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("velvet-admin-session")
        : null;
    const onBroadcast = (ev: MessageEvent) => {
      const type = (ev.data as { type?: string } | null)?.type;
      if (type !== "token-changed" && type !== "logout") return;
      memoryAdmin = null;
      setAdmin(null);
      clearCachedQueries();
      if (type === "logout" || !getAdminToken()) {
        setReady(true);
        router.replace("/login");
        return;
      }
      void refresh();
    };
    window.addEventListener("storage", onStorage);
    bc?.addEventListener("message", onBroadcast);
    return () => {
      window.removeEventListener("storage", onStorage);
      bc?.removeEventListener("message", onBroadcast);
      bc?.close();
    };
  }, [clearCachedQueries, refresh, router]);

  const logout = useCallback(async () => {
    await apiLogout();
    memoryAdmin = null;
    setAdmin(null);
    clearCachedQueries();
    try {
      new BroadcastChannel("velvet-admin-session").postMessage({ type: "logout" });
    } catch {
      /* ignore */
    }
    router.replace("/login");
  }, [router, clearCachedQueries]);

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
