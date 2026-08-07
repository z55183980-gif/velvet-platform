import { redirect } from "next/navigation";

export default function CreatorWithdrawRedirect() {
  redirect("/creator/wallet");
}
