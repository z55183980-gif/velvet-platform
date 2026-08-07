import type { ReactNode } from "react";
import { CreatorAccess } from "@/components/creator/creator-access";

export default function CreatorLayout({ children }: { children: ReactNode }) {
  return <CreatorAccess>{children}</CreatorAccess>;
}
