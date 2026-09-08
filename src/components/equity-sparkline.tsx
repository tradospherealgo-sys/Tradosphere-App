import type { EquityPoint } from "@/lib/analytics/stats";

/**
 * Realized equity curve. Plain SVG with no interaction — it is a shape, not
 * a chart, and the numbers beside it carry the precision.
 *
 * A single point is not a curve, so with fewer than two closed trades this
 * renders nothing rather than a flat line that implies a history the account
 * does not have.
 */
export function EquitySparkline({
  points,
  height = 64,
}: {
  points: EquityPoint[];
  height?: number;
}) {
  if (points.length < 2) return null;

  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 300;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.equity - min) / span) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "var(--color-up)" : "var(--color-down)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-16 w-full"
      role="img"
      aria-label={`Equity curve across ${points.length - 1} closed trades`}
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
