"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadSiteConfig, type SiteConfig } from "@/lib/api";

const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteName: "Velvet",
  supportEmail: "support@velvetmovie.space",
  supportUrl: "",
  termsUrl: "/terms",
  privacyUrl: "/privacy",
  maintenanceMode: false,
  maintenanceMessage: "",
  minWithdrawVnd: 100000,
};

const SiteConfigContext = createContext<SiteConfig>(DEFAULT_SITE_CONFIG);

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);

  useEffect(() => {
    let cancelled = false;
    void loadSiteConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => config, [config]);
  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig() {
  return useContext(SiteConfigContext);
}
