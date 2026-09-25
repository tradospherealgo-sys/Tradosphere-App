import "server-only";
import { quoteTtlMs } from "@/lib/market-data/market-hours";
import type { OptionChainProvider, OptionChainSnapshot, ProviderTestResult } from "./types";

/**
 * Caching / dedup / retry / circuit-breaker decorator around any
 * OptionChainProvider — the same shape as CachedMarketDataProvider
 * (src/lib/market-data/cache.ts), for the same reason: the option-chain
 * panel polls on a 15s auto-refresh while the market is open, and without
 * this layer every tick from every open tab would hit the upstream
 * provider directly. A cache miss with a failing upstream returns null/[]
 * — it never serves a stale chain as current and never fabricates one.
 *
 *   Caching — per underlying+expiry TTL, tied to the same open/closed
 *             quote TTL as quotes for the chain itself; expiries change at
 *             most once a day, so they get a longer, fixed TTL.
 *   Dedup   — concurrent requests for the same key share one upstream call.
 *   Retry   — one bounded retry, gated by a per-provider circuit breaker,
 *             for providers that throw. Providers in this codebase signal
 *             "no data" by returning null/[] rather than throwing, so that
 *             case is a real answer and is never retried.
 *   Breaker — once a provider has thrown enough consecutive times to look
 *             down, further calls skip upstream for a cooldown window.
 */

type CacheEntry<T> = { value: T; storedAt: number };

const expiriesCache = new Map<string, CacheEntry<string[]>>();
const chainCache = new Map<string, CacheEntry<OptionChainSnapshot>>();
const inFlight = new Map<string, Promise<unknown>>();

const MAX_CACHE_ENTRIES = 500;
const RETRY_DELAY_MS = 250;

// Expiry listings (weekly/monthly series) change at most once a day, never
// mid-session — a short TTL here would only add upstream load for no
// fresher an answer.
const EXPIRIES_TTL_MS = 5 * 60_000;

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000;

type BreakerState = { consecutiveFailures: number; openUntil: number };
const breakers = new Map<string, BreakerState>();

export class CachedOptionChainProvider implements OptionChainProvider {
  readonly name: string;
  readonly label: string;

  constructor(private readonly inner: OptionChainProvider) {
    this.name = inner.name;
    this.label = inner.label;
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  async getExpiries(underlying: string): Promise<string[]> {
    if (!this.isConfigured()) return [];

    const key = `${this.name}:${underlying.toUpperCase()}`;
    const cached = expiriesCache.get(key);
    if (cached && Date.now() - cached.storedAt < EXPIRIES_TTL_MS) return cached.value;

    const expiries = await dedupe(`expiries:${key}`, () =>
      withRetry(this.name, () => this.inner.getExpiries(underlying))
    );
    if (!expiries || expiries.length === 0) return [];

    store(expiriesCache, key, expiries);
    return expiries;
  }

  async getChain(underlying: string, expiry?: string): Promise<OptionChainSnapshot | null> {
    if (!this.isConfigured()) return null;

    const key = `${this.name}:${underlying.toUpperCase()}:${expiry ?? "default"}`;
    const cached = chainCache.get(key);
    if (cached && Date.now() - cached.storedAt < quoteTtlMs()) return cached.value;

    const snapshot = await dedupe(`chain:${key}`, () =>
      withRetry(this.name, () => this.inner.getChain(underlying, expiry))
    );
    if (!snapshot) return null;

    store(chainCache, key, snapshot);
    return snapshot;
  }

  testConnection(): Promise<ProviderTestResult> {
    // Never cached, never retried: an admin pressing "test" wants this
    // attempt's real result, including its failure.
    return this.inner.testConnection();
  }
}

/**
 * Collapses concurrent identical requests onto one upstream call. The entry
 * is removed in a `finally` so a rejected call never poisons later attempts.
 */
async function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function withRetry<T>(breakerKey: string, run: () => Promise<T>): Promise<T | null> {
  const breaker = breakers.get(breakerKey);
  if (breaker && Date.now() < breaker.openUntil) return null;

  try {
    const result = await run();
    breakers.delete(breakerKey);
    return result;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const result = await run();
      breakers.delete(breakerKey);
      return result;
    } catch {
      recordBreakerFailure(breakerKey);
      return null;
    }
  }
}

function recordBreakerFailure(key: string): void {
  const state = breakers.get(key) ?? { consecutiveFailures: 0, openUntil: 0 };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= BREAKER_THRESHOLD) {
    state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  }
  breakers.set(key, state);
}

/** Bounded LRU-ish eviction: drop the oldest insertion once over capacity. */
function store<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, storedAt: Date.now() });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

/** Test seam — lets unit tests start from a known-empty cache. */
export function __clearOptionChainCaches(): void {
  expiriesCache.clear();
  chainCache.clear();
  inFlight.clear();
  breakers.clear();
}
