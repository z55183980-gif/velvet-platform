import { redirect } from "next/navigation";

export default function CreatorKycRedirect() {
  redirect("/creator/wallet");
}
