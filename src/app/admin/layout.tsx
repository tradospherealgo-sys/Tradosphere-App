import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { AdminNavLinks } from "@/components/admin-nav-links";
import { MobileNav } from "@/components/mobile-nav";
import { ADMIN_NAV_ITEMS } from "@/lib/admin/nav";

// Admin data is per-request and role-gated — never statically prerendered.
export const dynamic = "force-dynamic";

// Short labels: the sidebar names ("Client Management") wrap to three lines
// in a fifth-of-a-phone-width bottom-bar cell.
const ADMIN_PRIMARY = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/signals", label: "Signals" },
  { href: "/admin/subscriptions", label: "Plans" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await getCurrentUser();

  if (!user) redirect("/login");
  if (!profile || profile.role !== "admin" || !profile.is_active) {
    redirect("/dashboard");
  }

  const identity = (
    <>
      <p className="truncate text-xs text-text-faint">{user.email}</p>
      <form action={signOut}>
        <button
          type="submit"
          className="mt-2 min-h-11 w-full rounded-xl border border-border px-3 text-left text-xs text-text-muted transition-colors hover:border-accent hover:text-text"
        >
          Sign out
        </button>
      </form>
    </>
  );

  const backLink = (
    <Link
      href="/dashboard"
      className="flex min-h-11 items-center rounded-xl px-3 text-sm text-accent hover:bg-surface-raised/60"
    >
      ← Back to client app
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 md:flex">
        <Link href="/admin" className="mb-1 px-2 text-lg font-semibold text-text">
          Admin Control Center
        </Link>
        <Link href="/dashboard" className="mb-6 px-2 text-xs text-accent hover:underline">
          ← Back to client app
        </Link>
        <AdminNavLinks />
        <div className="mt-auto px-2 pt-6">{identity}</div>
      </aside>

      <MobileNav
        items={ADMIN_NAV_ITEMS}
        primary={ADMIN_PRIMARY}
        title="Admin"
        homeHref="/admin"
        footer={identity}
        extraLink={backLink}
      />

      <main className="min-w-0 flex-1 overflow-x-hidden pb-20 md:pb-0">
        {children}
      </main>
    </div>
  );
}
