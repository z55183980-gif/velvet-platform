import { redirect } from "next/navigation";

export default async function AdminContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/content?modal=detail&id=${encodeURIComponent(id)}`);
}
