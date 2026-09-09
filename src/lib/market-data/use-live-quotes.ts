"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketStatus } from "./market-hours";
import type { Quote } from "./types";

/**
 * Client-side subscription to the server's quote stream.
 *
 * The browser talks only to /api/market/stream — it never learns which
 * provider is behind it and never holds a credential. Quotes are keyed by
 * symbol so a component can render "no data" for exactly the symbols the
 * provider could not resolve, instead of blanking the whole panel.
 *
 * `receivedAt` is recorded per symbol so the UI can age a price out visually.
 * A tile that has not updated in a minute must look different from one that
 * just ticked, otherwise a frozen feed reads as a flat market.
 */

export type LiveQuotesState = {
  quotes: Record<string, Quote>;
  receivedAt: Record<string, number>;
  status: MarketStatus | null;
  configured: boolean;
  /** True once the stream is open, regardless of whether data has arrived. */
  connected: boolean;
  error: string | null;
};

const INITIAL: LiveQuotesState = {
  quotes: {},
  receivedAt: {},
  status: null,
  configured: true,
  connected: false,
  error: null,
};

export function useLiveQuotes(symbols: string[]): LiveQuotesState {
  // Symbol arrays are usually built inline at the call site, so a fresh array
  // identity on every render would tear the stream down and rebuild it in a
  // loop. Keying the effect on the joined string fixes the identity.
  const key = useMemo(
    () => Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))).sort().join(","),
    [symbols]
  );

  const [state, setState] = useState<LiveQuotesState>(INITIAL);

  useEffect(() => {
    if (!key) return;

    const source = new EventSource(`/api/market/stream?symbols=${encodeURIComponent(key)}`);

    const onOpen = (event: MessageEvent) => {
      const payload = safeParse<{ configured?: boolean }>(event.data);
      setState((prev) => ({
        ...prev,
        connected: true,
        error: null,
        configured: payload?.configured ?? prev.configured,
      }));
    };

    const onQuotes = (event: MessageEvent) => {
      const payload = safeParse<{ quotes: Quote[]; status: MarketStatus }>(event.data);
      if (!payload) return;
      const now = Date.now();
      setState((prev) => {
        const quotes = { ...prev.quotes };
        const receivedAt = { ...prev.receivedAt };
        for (const quote of payload.quotes) {
          quotes[quote.symbol.toUpperCase()] = quote;
          receivedAt[quote.symbol.toUpperCase()] = now;
        }
        return { ...prev, quotes, receivedAt, status: payload.status, error: null };
      });
    };

    const onError = () => {
      // EventSource reconnects on its own; surfacing the drop lets the UI mark
      // prices stale in the meantime rather than presenting them as live.
      setState((prev) => ({ ...prev, connected: false, error: "Live feed interrupted." }));
    };

    source.addEventListener("open", onOpen as EventListener);
    source.addEventListener("quotes", onQuotes as EventListener);
    source.addEventListener("error", onError);

    return () => {
      source.removeEventListener("open", onOpen as EventListener);
      source.removeEventListener("quotes", onQuotes as EventListener);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [key]);

  // Narrowing at render rather than clearing state on change keeps the
  // subscription switch free of an extra render pass, and guarantees a symbol
  // dropped from the watchlist can never keep showing its last price.
  return useMemo(() => {
    if (!key) return INITIAL;
    const wanted = new Set(key.split(","));
    return {
      ...state,
      quotes: pickKeys(state.quotes, wanted),
      receivedAt: pickKeys(state.receivedAt, wanted),
    };
  }, [key, state]);
}

function pickKeys<T>(source: Record<string, T>, wanted: Set<string>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [k, v] of Object.entries(source)) {
    if (wanted.has(k)) result[k] = v;
  }
  return result;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
