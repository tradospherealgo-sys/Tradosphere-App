"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CreditCard,
  Home,
  LayoutGrid,
  LineChart,
  Menu,
  Radio,
  TrendingUpDown,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { NavItem } from "@/lib/nav";

/**
 * Phone navigation: a fixed bottom bar for the five most-used destinations
 * and a drawer for the rest.
 *
 * The sidebar this replaces was `hidden … md:flex`, which left phones with
 * no navigation at all. Everything here is sized to a 44px minimum touch
 * target and sits above the gesture inset via `env(safe-area-inset-bottom)`,
 * which matters on Android gesture navigation where the bottom edge of the
 * viewport is not reachable.
 */

const ICONS: Record<string, typeof Home> = {
  "/dashboard": Home,
  "/signals": Radio,
  "/markets": LineChart,
  "/paper-trading": TrendingUpDown,
  "/portfolio": Wallet,
  "/admin": LayoutGrid,
  "/admin/clients": Users,
  "/admin/signals": Radio,
  "/admin/subscriptions": CreditCard,
};

export function MobileNav({
  items,
  primary,
  title,
  homeHref,
  unreadCount = 0,
  notificationsHref,
  footer,
  extraLink,
}: {
  items: NavItem[];
  primary: NavItem[];
  title: string;
  homeHref: string;
  unreadCount?: number;
  /** Omit to hide the bell — the admin shell has no client inbox. */
  notificationsHref?: string;
  footer: React.ReactNode;
  extraLink?: React.ReactNode;
}) {
  const pathname = usePathname();

  // The drawer closes on navigation — otherwise it stays parked over the
  // page the user just asked for. That is derived rather than synced: we
  // remember which route it was opened on, and it is only open while we are
  // still there. An effect calling setState here would render twice on
  // every navigation.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedOn(null);
    };
    document.addEventListener("keydown", onKey);
    // Locking the body prevents the page behind the drawer from scrolling
    // under the user's finger.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const isActive = (href: string) =>
    pathname === href || (href !== homeHref && pathname?.startsWith(href + "/"));

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/95 px-3 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="flex size-11 items-center justify-center rounded-xl text-text-muted active:bg-surface-raised"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Link
          href={homeHref}
          className="flex min-h-11 items-center truncate text-base font-semibold text-text"
        >
          {title}
        </Link>
        {notificationsHref ? (
          <Link
            href={notificationsHref}
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            className="relative ml-auto flex size-11 items-center justify-center rounded-xl text-text-muted active:bg-surface-raised"
          >
            <Bell className="size-5" aria-hidden />
            {unreadCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-accent px-1 text-[10px] font-medium leading-4 text-bg">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
        ) : null}
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-base font-semibold text-text">{title}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex size-11 items-center justify-center rounded-xl text-text-muted active:bg-surface-raised"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {extraLink ? <div className="mb-2">{extraLink}</div> : null}
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={`flex min-h-11 items-center rounded-xl px-3 text-sm ${
                        isActive(item.href)
                          ? "bg-surface-raised font-medium text-text"
                          : "text-text-muted active:bg-surface-raised/60"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="border-t border-border px-4 py-3">{footer}</div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {primary.map((item) => {
          const Icon = ICONS[item.href] ?? LayoutGrid;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] ${
                active ? "text-accent" : "text-text-muted"
              }`}
            >
              <Icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] text-text-muted"
        >
          <Menu className="size-5" aria-hidden />
          More
        </button>
      </nav>
    </>
  );
}
