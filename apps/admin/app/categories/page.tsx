import { redirect } from "next/navigation";

export default function AdminCategoriesPage() {
  redirect("/content?modal=categories");
}
