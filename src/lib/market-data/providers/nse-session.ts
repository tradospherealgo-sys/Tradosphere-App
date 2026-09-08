import "server-only";

/**
 * Shared session/fetch plumbing for NSE India's public (unofficial) JSON
 * endpoints, used by both the market-data connector
 * (nse-unofficial.ts) and the option-chain connector
 * (src/lib/options/providers/nse-unofficial.ts) — same origin, same cookie
 * handshake, same rate-limiting caveats.
 */

export const NSE_BASE = "https://www.nseindia.com";

export const NSE_BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${NSE_BASE}/`,
};

let cookieCache: { cookie: string; fetchedAt: number } | null = null;
const COOKIE_TTL_MS = 4 * 60 * 1000;

async function getNseSessionCookie(): Promise<string> {
  if (cookieCache && Date.now() - cookieCache.fetchedAt < COOKIE_TTL_MS) {
    return cookieCache.cookie;
  }

  const res = await fetch(`${NSE_BASE}/`, { headers: NSE_BROWSER_HEADERS, cache: "no-store" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");

  cookieCache = { cookie, fetchedAt: Date.now() };
  return cookie;
}

export async function nseGet<T>(path: string): Promise<T | null> {
  try {
    const cookie = await getNseSessionCookie();
    const res = await fetch(`${NSE_BASE}${path}`, {
      headers: { ...NSE_BROWSER_HEADERS, Cookie: cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
