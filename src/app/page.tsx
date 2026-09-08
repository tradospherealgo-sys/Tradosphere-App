import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

// Always dynamic: depends on the signed-in user's session, which can't be
// known at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { user } = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
