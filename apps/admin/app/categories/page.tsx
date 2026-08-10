import { redirect } from "next/navigation";

/** Legacy /categories → drama tags management. */
export default function AdminCategoriesRedirectPage() {
  redirect("/tags");
}
