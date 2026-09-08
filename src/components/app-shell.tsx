import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { MobileNav } from "@/components/mobile-nav";
import { NAV_ITEMS, PRIMARY_NAV } from "@/lib/nav";
import { signOut } from "@/lib/auth/actions";

export function AppShell({
  user,
  role,
  isAdmin,
  unreadCount,
  children,
}: {
  user: { email: string | null };
  role: string;
  isAdmin: boolean;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const identity = (
    <>
      <p className="truncate text-xs text-text-faint">{user.email}</p>
      <p className="text-xs text-text-faint">{role}</p>
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

  const adminLink = isAdmin ? (
    <Link
      href="/admin"
      className="flex min-h-11 items-center rounded-xl px-3 text-sm text-accent hover:bg-surface-raised/60"
    >
      Admin Control Center
    </Link>
  ) : null;

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 md:flex">
        <Link href="/dashboard" className="mb-6 px-2 text-lg font-semibold text-text">
          Tradosphere
        </Link>
        <NavLinks />
        {adminLink ? (
          <>
            <div className="my-4 border-t border-border" />
            {adminLink}
          </>
        ) : null}
        <div className="mt-auto px-2 pt-6">{identity}</div>
      </aside>

      <MobileNav
        items={NAV_ITEMS}
        primary={PRIMARY_NAV}
        title="Tradosphere"
        homeHref="/dashboard"
        unreadCount={unreadCount}
        notificationsHref="/notifications"
        footer={identity}
        extraLink={adminLink}
      />

      {/* The bottom bar is fixed, so the last card on a page would sit under
          it without this padding. */}
      <main className="min-w-0 flex-1 overflow-x-hidden pb-20 md:pb-0">
        {children}
      </main>
    </div>
  );
}
