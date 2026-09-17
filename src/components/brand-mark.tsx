/**
 * Small circular brand mark used next to the "Tradosphere" wordmark.
 *
 * Echoes the existing app icon (three ascending bars) rather than
 * inventing a new symbol, just re-drawn in the new emerald/cyber-teal
 * identity so the mark sits comfortably in the redesigned chrome.
 *
 * Plain fills only (no gradient `<defs>`/id) — this renders in more than
 * one place at once (desktop sidebar + mobile header both mount, one just
 * hidden by a breakpoint class), and duplicate SVG ids on the page is the
 * kind of thing worth just not risking for a decorative mark.
 */
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Tradosphere"
    >
      <circle
        cx="16"
        cy="16"
        r="14.5"
        fill="var(--color-surface)"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
      />
      <rect x="10" y="16" width="2.6" height="7" rx="1" fill="var(--color-accent)" />
      <rect x="14.7" y="12" width="2.6" height="11" rx="1" fill="var(--color-accent-strong)" />
      <rect x="19.4" y="8" width="2.6" height="15" rx="1" fill="var(--color-accent-strong)" />
    </svg>
  );
}
