export type NavItem = { href: string; label: string };

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/clients", label: "Client Management" },
  { href: "/admin/integrations", label: "Integrations" },
  { href: "/admin/signals", label: "Signal Desk" },
  { href: "/admin/trading", label: "Paper Trading" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/education", label: "Education CMS" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/settings", label: "System Settings" },
  { href: "/admin/audit-logs", label: "Audit Logs" },
  { href: "/admin/health", label: "System Health" },
];
