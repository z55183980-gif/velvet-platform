"use client";

import { useSiteConfig } from "@/lib/site-config";
import { useLocale } from "@/lib/i18n";

export function MaintenanceBanner() {
  const config = useSiteConfig();
  const { t } = useLocale();
  if (!config.maintenanceMode) return null;
  const message =
    config.maintenanceMessage.trim() || t("common.maintenanceDefault");
  return (
    <div
      role="status"
      className="border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-center text-[13px] leading-5 text-amber-100"
    >
      {message}
    </div>
  );
}
