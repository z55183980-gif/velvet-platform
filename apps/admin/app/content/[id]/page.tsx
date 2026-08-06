import { redirect } from "next/navigation";

export default async function AdminContentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const qs = new URLSearchParams({ modal: "detail", id });
  if (tab === "overview" || tab === "info" || tab === "episodes" || tab === "policy") {
    qs.set("tab", tab);
  }
  redirect(`/content?${qs.toString()}`);
}
