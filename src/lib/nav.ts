export type NavItem = { href: string; label: string };

/**
 * The five destinations pinned to the bottom bar on phones. A sixth "More"
 * slot opens the drawer holding everything else. Paper Trading sits between
 * Markets and Portfolio because it's the action a user takes on a signal or
 * a market move, not just something they read — worth the extra column over
 * demoting it to the drawer.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/signals", label: "Signals" },
  { href: "/markets", label: "Markets" },
  { href: "/paper-trading", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
];

/**
 * The 12 client-app sections from the V1 spec, in sidebar order.
 * Admin Control Center is a separate nav tree under /admin (role-gated).
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/signals", label: "Signals" },
  { href: "/markets", label: "Live Market Overview" },
  { href: "/charts", label: "Interactive Charts" },
  { href: "/option-chain", label: "Option Chain" },
  { href: "/paper-trading", label: "Paper Trading" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/ai-intelligence", label: "AI Intelligence" },
  { href: "/education", label: "Education & Coach" },
  { href: "/activity", label: "Activity / Journal" },
  { href: "/notifications", label: "Notifications" },
  { href: "/subscription", label: "Subscription" },
  { href: "/settings", label: "Profile & Settings" },
];
