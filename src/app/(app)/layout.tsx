import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/app-data/reads";
import { AppShell } from "@/components/app-shell";

// Every page under this group depends on the signed-in user's session and
// their own private data (paper account, positions, orders, ...) — none of
// it is safe or meaningful to statically prerender.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getCurrentUser();
  if (!user) redirect("/login");

  const unreadCount = await getUnreadNotificationCount();

  return (
    <AppShell
      user={{ email: user.email }}
      role={profile?.role ?? "user"}
      isAdmin={profile?.role === "admin" && !!profile?.is_active}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
