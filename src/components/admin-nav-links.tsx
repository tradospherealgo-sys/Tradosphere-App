"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { ADMIN_NAV_ITEMS } from "@/lib/admin/nav";
import { NAV_ICONS } from "@/lib/nav-icons";

export function AdminNavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {ADMIN_NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/admin" && pathname?.startsWith(item.href + "/"));
        const Icon = NAV_ICONS[item.href] ?? LayoutGrid;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-accent-muted text-accent-strong font-medium"
                : "text-text-muted hover:bg-surface-raised/60 hover:text-text"
            }`}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
