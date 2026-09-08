"use client";

import { useMemo, useRef, useState } from "react";
import { buildOverlays, rsi, type IndicatorKey } from "@/lib/charts/indicators";
import type { Candle } from "@/lib/market-data/types";

/**
 * Candlestick chart rendered as plain SVG.
 *
 * Written by hand rather than pulled from a charting library because the
 * requirement is Android-first touch interaction — one-finger pan, two-finger
 * pinch zoom — and the usual React chart libraries assume a mouse with a
 * scroll wheel. Pointer Events give us both input types through one code
 * path.
 *
 * The visible window is a [start, end) slice of the candle array held in
 * state; pan moves it, pinch resizes it. Everything else (price scale,
 * overlays, crosshair) is derived from that slice, so there is no separate
 * zoom transform to keep in sync.
 */

const MIN_VISIBLE = 15;

type Props = {
  candles: Candle[];
  indicators: IndicatorKey[];
  showRsi?: boolean;
  height?: number;
};

export function CandlestickChart({
  candles,
  indicators,
  showRsi = false,
  height = 340,
}: Props) {
  const [view, setView] = useState<{ start: number; end: number }>(() => ({
    start: Math.max(0, candles.length - 120),
    end: candles.length,
  }));
  const [cursor, setCursor] = useState<number | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: number; end: number; anchorX: number; spread: number } | null>(
    null
  );

  const visible = candles.slice(view.start, view.end);
  const overlays = useMemo(() => buildOverlays(candles, indicators), [candles, indicators]);
  const rsiSeries = useMemo(
    () => (showRsi ? rsi(candles.map((c) => c.close), 14) : null),
    [candles, showRsi]
  );

  const priceHeight = showRsi ? height * 0.72 : height;
  const rsiTop = priceHeight + 12;
  const rsiHeight = showRsi ? height - priceHeight - 12 : 0;
  const totalHeight = height;

  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of visible) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    for (const o of overlays) {
      for (let i = view.start; i < view.end; i++) {
        const v = o.values[i];
        if (v === null || v === undefined) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
    // A perfectly flat window would divide by zero; give it a nominal band.
    if (hi === lo) return { min: lo - 1, max: hi + 1 };
    const pad = (hi - lo) * 0.06;
    return { min: lo - pad, max: hi + pad };
  }, [visible, overlays, view.start, view.end]);

  const width = 1000; // viewBox units; SVG scales to the container
  const slot = visible.length > 0 ? width / visible.length : width;
  const bodyWidth = Math.max(1, slot * 0.62);

  const yOf = (price: number) => priceHeight - ((price - min) / (max - min)) * priceHeight;
  const xOf = (i: number) => i * slot + slot / 2;

  function applyGesture(e: React.PointerEvent<SVGSVGElement>) {
    const points = Array.from(pointers.current.values());
    const g = gesture.current;
    if (!g || points.length === 0) return;

    const span = g.end - g.start;

    if (points.length === 1) {
      const dx = points[0].x - g.anchorX;
      const shift = Math.round((dx / (svgRef.current?.clientWidth ?? width)) * span);
      let start = g.start - shift;
      start = Math.max(0, Math.min(candles.length - span, start));
      setView({ start, end: start + span });
      return;
    }

    const spread = Math.abs(points[0].x - points[1].x);
    if (g.spread <= 0 || spread <= 0) return;

    const scale = g.spread / spread;
    let newSpan = Math.round(span * scale);
    newSpan = Math.max(MIN_VISIBLE, Math.min(candles.length, newSpan));

    // Zoom around the midpoint of the two fingers so the candle under the
    // pinch stays roughly put, which is what makes it feel anchored.
    const centerRatio = 0.5;
    const center = g.start + span * centerRatio;
    let start = Math.round(center - newSpan * centerRatio);
    start = Math.max(0, Math.min(candles.length - newSpan, start));
    setView({ start, end: start + newSpan });
    e.preventDefault();
  }

  function beginGesture() {
    const points = Array.from(pointers.current.values());
    gesture.current = {
      start: view.start,
      end: view.end,
      anchorX: points[0]?.x ?? 0,
      spread: points.length > 1 ? Math.abs(points[0].x - points[1].x) : 0,
    };
  }

  if (candles.length === 0) return null;

  const hovered = cursor !== null ? visible[cursor] : null;

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        {hovered ? (
          <>
            <span className="text-text-faint">
              {new Date(hovered.ts).toLocaleString("en-IN")}
            </span>
            <span>O {hovered.open}</span>
            <span>H {hovered.high}</span>
            <span>L {hovered.low}</span>
            <span className="text-text">C {hovered.close}</span>
            {hovered.volume != null && <span>V {hovered.volume.toLocaleString("en-IN")}</span>}
          </>
        ) : (
          <span className="text-text-faint">
            Drag to pan, pinch to zoom · showing {visible.length} of {candles.length} candles
          </span>
        )}
        {overlays.map((o) => (
          <span key={o.key} style={{ color: o.color }}>
            {o.label}
          </span>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${totalHeight}`}
        preserveAspectRatio="none"
        className="w-full touch-none select-none"
        style={{ height: totalHeight }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          beginGesture();
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            applyGesture(e);
            return;
          }
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect || visible.length === 0) return;
          const ratio = (e.clientX - rect.left) / rect.width;
          setCursor(Math.max(0, Math.min(visible.length - 1, Math.floor(ratio * visible.length))));
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size > 0) beginGesture();
          else gesture.current = null;
        }}
        onPointerLeave={() => {
          pointers.current.clear();
          gesture.current = null;
          setCursor(null);
        }}
      >
        {gridLines(min, max).map((price) => (
          <g key={price}>
            <line
              x1={0}
              x2={width}
              y1={yOf(price)}
              y2={yOf(price)}
              stroke="#2a2d42"
              strokeWidth={1}
            />
            <text x={4} y={yOf(price) - 4} fill="#6c6f87" fontSize={11}>
              {price.toFixed(2)}
            </text>
          </g>
        ))}

        {visible.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? "#2fbf7a" : "#e0616b";
          const bodyTop = yOf(Math.max(c.open, c.close));
          const bodyBottom = yOf(Math.min(c.open, c.close));
          return (
            <g key={c.ts}>
              <line
                x1={xOf(i)}
                x2={xOf(i)}
                y1={yOf(c.high)}
                y2={yOf(c.low)}
                stroke={color}
                strokeWidth={1}
              />
              <rect
                x={xOf(i) - bodyWidth / 2}
                y={bodyTop}
                width={bodyWidth}
                height={Math.max(1, bodyBottom - bodyTop)}
                fill={color}
              />
            </g>
          );
        })}

        {overlays.map((o) => (
          <path
            key={o.key}
            d={linePath(o.values.slice(view.start, view.end), xOf, yOf)}
            fill="none"
            stroke={o.color}
            strokeWidth={1.5}
          />
        ))}

        {cursor !== null && (
          <line
            x1={xOf(cursor)}
            x2={xOf(cursor)}
            y1={0}
            y2={priceHeight}
            stroke="#9497b0"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}

        {showRsi && rsiSeries && (
          <g transform={`translate(0, ${rsiTop})`}>
            <rect x={0} y={0} width={width} height={rsiHeight} fill="#12131e" opacity={0.4} />
            {[30, 70].map((level) => (
              <line
                key={level}
                x1={0}
                x2={width}
                y1={rsiHeight - (level / 100) * rsiHeight}
                y2={rsiHeight - (level / 100) * rsiHeight}
                stroke="#2a2d42"
                strokeDasharray="3 3"
              />
            ))}
            <text x={4} y={12} fill="#6c6f87" fontSize={11}>
              RSI 14
            </text>
            <path
              d={linePath(
                rsiSeries.slice(view.start, view.end),
                xOf,
                (v) => rsiHeight - (v / 100) * rsiHeight
              )}
              fill="none"
              stroke="#9184d9"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * Builds a path that *breaks* across null gaps rather than drawing a
 * straight line over them — an indicator's warm-up period should read as
 * absent, not as a flat trend.
 */
function linePath(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number
): string {
  let d = "";
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      penDown = false;
      continue;
    }
    d += `${penDown ? "L" : "M"}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)} `;
    penDown = true;
  }
  return d.trim();
}

function gridLines(min: number, max: number): number[] {
  const steps = 5;
  return Array.from({ length: steps }, (_, i) => min + ((max - min) * i) / (steps - 1));
}
