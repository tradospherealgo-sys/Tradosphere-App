"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { buildOverlays, rsi, type IndicatorKey } from "@/lib/charts/indicators";
import type { Candle } from "@/lib/market-data/types";

/**
 * Candlestick chart built on lightweight-charts (TradingView, MIT).
 *
 * Replaces a hand-rolled SVG renderer. The reason is not aesthetics: the SVG
 * version reimplemented pan, pinch-zoom, crosshair and price-scale
 * autoscaling by hand, and on a touch device those are exactly the details
 * that make a chart feel broken. This library does them natively, which
 * matters because Android is a first-class target here.
 *
 * The chart renders only what the provider returned. Bars are never
 * interpolated to fill a gap, and a missing indicator warm-up value is left
 * as a hole in the line rather than back-filled with the first known value.
 */

export type PriceChartProps = {
  candles: Candle[];
  indicators: IndicatorKey[];
  showRsi: boolean;
  /** True when the interval is intraday, which changes the time-axis format. */
  intraday: boolean;
  height?: number;
};

const COLORS = {
  up: "#2fbf7a",
  down: "#e0616b",
  grid: "#2a2d42",
  text: "#9497b0",
  accent: "#9184d9",
};

export function PriceChart({
  candles,
  indicators,
  showRsi,
  intraday,
  height = 420,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // The chart instance outlives data changes: recreating it on every prop
  // change would throw away the user's pan/zoom position mid-session.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: COLORS.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      rightPriceScale: { borderColor: COLORS.grid },
      timeScale: { borderColor: COLORS.grid, timeVisible: intraday, secondsVisible: false },
      crosshair: { mode: 1 },
      localization: { locale: "en-IN" },
    });

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [intraday]);

  // Series are torn down and rebuilt whenever the data or the enabled
  // indicator set changes. Rebuilding is cheap next to the bookkeeping of
  // diffing an arbitrary overlay set against live series handles.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Indicators are computed from the same normalized series the bars are
    // drawn from, so an out-of-order bar from the provider cannot shift a
    // moving average one candle off from the price it is drawn against.
    const ordered = normalize(candles);
    const points = toChartPoints(ordered);
    const created: ISeriesApi<"Candlestick" | "Histogram" | "Line">[] = [];

    const price = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
    });
    price.setData(points.map((p) => p.bar));
    created.push(price);

    // Volume shares the price pane but gets its own invisible scale, pinned
    // to the bottom quarter so it reads as context rather than competing
    // with price for vertical space.
    const volumePoints = points.filter((p) => p.volume !== null);
    if (volumePoints.length > 0) {
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      volume.setData(
        volumePoints.map((p) => ({
          time: p.bar.time,
          value: p.volume as number,
          color: p.bar.close >= p.bar.open ? `${COLORS.up}55` : `${COLORS.down}55`,
        }))
      );
      chart
        .priceScale("volume")
        .applyOptions({ scaleMargins: { top: 0.78, bottom: 0 }, visible: false });
      created.push(volume);
    }

    for (const overlay of buildOverlays(ordered, indicators)) {
      const line = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(toLinePoints(points, overlay.values));
      created.push(line);
    }

    if (showRsi) {
      // A separate pane, not an overlay: RSI is bounded 0-100 and would
      // flatten the price scale into a line if it shared an axis.
      const rsiSeries = chart.addSeries(
        LineSeries,
        { color: COLORS.accent, lineWidth: 1, priceLineVisible: false },
        1
      );
      rsiSeries.setData(toLinePoints(points, rsi(ordered.map((c) => c.close))));
      chart.panes()[1]?.setHeight(110);
      created.push(rsiSeries);
    }

    chart.timeScale().fitContent();

    return () => {
      for (const series of created) {
        try {
          chart.removeSeries(series);
        } catch {
          // The chart was disposed first by the effect above; nothing to undo.
        }
      }
    };
  }, [candles, indicators, showRsi]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}

type ChartPoint = {
  bar: {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  };
  volume: number | null;
};

/**
 * lightweight-charts requires strictly ascending, unique timestamps and
 * throws on violation. Providers occasionally repeat or misorder a bar, so
 * the series is sorted and de-duplicated here rather than trusting the feed.
 * Bars are dropped or reordered, never merged or synthesized.
 */
export function normalize(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();

  for (const candle of candles) {
    const ms = new Date(candle.ts).getTime();
    if (Number.isNaN(ms)) continue;
    byTime.set(Math.floor(ms / 1000), candle);
  }

  return Array.from(byTime.entries())
    .sort(([a], [b]) => a - b)
    .map(([, candle]) => candle);
}

function toChartPoints(candles: Candle[]): ChartPoint[] {
  return candles.map((candle) => ({
    bar: {
      time: Math.floor(new Date(candle.ts).getTime() / 1000) as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    },
    volume: candle.volume,
  }));
}

/**
 * Aligns an indicator series to the chart points, dropping the nulls that
 * indicators emit during their warm-up window. Omitting a point leaves a gap;
 * substituting a value would draw a moving average that never existed.
 */
function toLinePoints(
  points: ChartPoint[],
  values: (number | null)[]
): { time: UTCTimestamp; value: number }[] {
  const result: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const value = values[i];
    if (value == null || !Number.isFinite(value)) continue;
    result.push({ time: points[i].bar.time, value });
  }
  return result;
}
