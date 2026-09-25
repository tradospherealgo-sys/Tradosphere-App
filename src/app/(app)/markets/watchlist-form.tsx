"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import {
  createWatchlist,
  addWatchlistItem,
  removeWatchlistItem,
  deleteWatchlist,
} from "@/lib/app-data/actions";

type Watchlist = {
  id: string;
  name: string;
  watchlist_items: { id: string; symbol: string }[];
};

type Instrument = { symbol: string; name: string | null };

export function WatchlistForm({
  watchlists,
  instruments = [],
}: {
  watchlists: Watchlist[];
  instruments?: Instrument[];
}) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [targetId, setTargetId] = useState(watchlists[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const removeItem = (itemId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await removeWatchlistItem(itemId);
      if (!res.ok) setError(res.error);
    });
  };

  const removeWatchlist = (watchlistId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await deleteWatchlist(watchlistId);
      if (!res.ok) setError(res.error);
    });
  };

  return (
    <div className="space-y-6">
      {watchlists.length > 0 && (
        <ul className="space-y-2">
          {watchlists.map((w) => (
            <li key={w.id} className="text-sm text-text-muted">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text">{w.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeWatchlist(w.id)}
                  className="text-xs text-text-faint hover:text-down disabled:opacity-50"
                >
                  Delete watchlist
                </button>
              </div>
              {w.watchlist_items.length === 0 ? (
                <p className="mt-1">no symbols yet</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {w.watchlist_items.map((i) => (
                    <li
                      key={i.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-text"
                    >
                      {i.symbol}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => removeItem(i.id)}
                        aria-label={`Remove ${i.symbol}`}
                        className="text-text-faint hover:text-down disabled:opacity-50"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-down">{error}</p>}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await createWatchlist(name);
            if (!res.ok) setError(res.error);
            else setName("");
          });
        }}
      >
        <div>
          <label className="block text-xs text-text-faint">New watchlist name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
            placeholder="e.g. Nifty 50"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {watchlists.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const res = await addWatchlistItem(targetId, symbol);
              if (!res.ok) setError(res.error);
              else setSymbol("");
            });
          }}
        >
          <div>
            <label className="block text-xs text-text-faint">Watchlist</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="mt-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
            >
              {watchlists.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-faint">Add symbol</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              list="watchlist-instrument-options"
              autoCapitalize="characters"
              className="mt-1 rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
              placeholder="e.g. RELIANCE"
            />
            <datalist id="watchlist-instrument-options">
              {instruments.map((i) => (
                <option key={i.symbol} value={i.symbol}>
                  {i.name ?? i.symbol}
                </option>
              ))}
            </datalist>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}
    </div>
  );
}
