export type NavItem = { href: string; label: string };

/**
 * The four destinations pinned to the bottom bar on phones. A fifth "More"
 * slot opens the drawer holding everything else. Paper Trading is not a
 * launch feature (its page is a "coming soon" placeholder — the engine
 * behind it stays intact for later) and is therefore not pinned here.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/signals", label: "Signals" },
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
];

/**
 * The client-app sections from the V1 spec, in sidebar order. Paper Trading
 * is intentionally excluded: it is not a launch feature and its page is a
 * "coming soon" placeholder (the engine behind it stays intact for later).
 * Admin Control Center is a separate nav tree under /admin (role-gated).
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/signals", label: "Signals" },
  { href: "/markets", label: "Live Market Overview" },
  { href: "/charts", label: "Interactive Charts" },
  { href: "/option-chain", label: "Option Chain" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/ai-intelligence", label: "AI Intelligence" },
  { href: "/education", label: "Education & Coach" },
  { href: "/activity", label: "Activity / Journal" },
  { href: "/notifications", label: "Notifications" },
  { href: "/subscription", label: "Subscription" },
  { href: "/settings", label: "Profile & Settings" },
];

/**
 * Same destinations, grouped for the desktop sidebar only. The mobile
 * drawer keeps the flat `NAV_ITEMS` list — headers add scroll length without
 * helping on a list this short once it's already on a phone.
 */
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: NAV_ITEMS.filter((i) => ["/dashboard", "/signals"].includes(i.href)),
  },
  {
    label: "Markets & Trading",
    items: NAV_ITEMS.filter((i) =>
      ["/markets", "/charts", "/option-chain"].includes(i.href)
    ),
  },
  {
    label: "Portfolio & Learning",
    items: NAV_ITEMS.filter((i) =>
      ["/portfolio", "/ai-intelligence", "/education", "/activity"].includes(i.href)
    ),
  },
  {
    label: "Account",
    items: NAV_ITEMS.filter((i) =>
      ["/notifications", "/subscription", "/settings"].includes(i.href)
    ),
  },
];
