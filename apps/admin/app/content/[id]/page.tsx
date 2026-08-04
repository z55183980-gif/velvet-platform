import { redirect } from "next/navigation";

export default async function AdminContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await Promise.resolve(params);
  redirect(`/content?modal=detail&id=${encodeURIComponent(id)}`);
}
