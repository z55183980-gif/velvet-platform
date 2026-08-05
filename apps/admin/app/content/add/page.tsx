import { redirect } from "next/navigation";

export default async function AdminContentAddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tabRaw = sp.tab;
  const tab = Array.isArray(tabRaw) ? tabRaw[0] : tabRaw;
  const qs = new URLSearchParams({ modal: "add" });
  if (tab === "online") qs.set("tab", "online");
  redirect(`/content?${qs.toString()}`);
}
