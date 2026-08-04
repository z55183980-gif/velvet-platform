import { redirect } from "next/navigation";

/** 经营报表已合并进数据概览工作台 */
export default function AnalyticsRedirectPage() {
  redirect("/dashboard");
}
