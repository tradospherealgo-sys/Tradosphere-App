import "server-only";
import { createHmac } from "crypto";

/**
 * Shared SMC Global session + response-mapping layer.
 *
 * Both the market-data connector (providers/smc.ts) and the option-chain
 * connector (src/lib/options/providers/smc.ts) talk to the same SMC account
 * over the same session. Keeping the login, the token cache and the
 * response-path readers here means one connection is opened per credential
 * prefix rather than one per feature, and a vendor response-shape change is
 * fixed in one place.
 *
 * Credentials are read from server-side env vars only. `prefix` names the
 * env-var family (default `SMC`), so a deployment can run two SMC
 * connections side by side:
 *
 *   {PREFIX}_API_KEY      API key issued with the SMC API subscription
 *   {PREFIX}_CLIENT_CODE  SMC client / user id
 *   {PREFIX}_API_SECRET   API secret or password used at login
 *   {PREFIX}_TOTP_SECRET  optional base32 TOTP seed, if 2FA is enforced
 */

export type PathMap = Record<string, string>;

export type SmcBaseConfig = {
  baseUrl?: string;
  loginPath?: string;
  /** Exchange segment sent with each request, e.g. "NSE" or "NFO". */
  exchange?: string;
};

/** Session tokens are short-lived; cache per prefix and re-login on expiry. */
const sessionCache = new Map<string, { token: string; fetchedAt: number }>();
const SESSION_TTL_MS = 30 * 60 * 1000;

export class SmcSession {
  readonly prefix: string;
  private readonly cfg: SmcBaseConfig;

  constructor(config: SmcBaseConfig, secretEnvVar: string | null) {
    this.cfg = config ?? {};
    this.prefix = secretEnvVar?.trim() || "SMC";
  }

  get baseUrl() {
    return this.cfg.baseUrl ?? null;
  }
  get apiKey() {
    return process.env[`${this.prefix}_API_KEY`] ?? null;
  }
  get clientCode() {
    return process.env[`${this.prefix}_CLIENT_CODE`] ?? null;
  }
  get apiSecret() {
    return process.env[`${this.prefix}_API_SECRET`] ?? null;
  }
  get totpSecret() {
    return process.env[`${this.prefix}_TOTP_SECRET`] ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.clientCode && this.apiSecret);
  }

  /** Missing-prerequisite description, for the admin "test connection" panel. */
  missing(): string | null {
    const gaps: string[] = [];
    if (!this.baseUrl) gaps.push("config.baseUrl");
    if (!this.apiKey) gaps.push(`${this.prefix}_API_KEY`);
    if (!this.clientCode) gaps.push(`${this.prefix}_CLIENT_CODE`);
    if (!this.apiSecret) gaps.push(`${this.prefix}_API_SECRET`);
    return gaps.length ? gaps.join(", ") : null;
  }

  async login(): Promise<string | null> {
    const cached = sessionCache.get(this.prefix);
    if (cached && Date.now() - cached.fetchedAt < SESSION_TTL_MS) {
      return cached.token;
    }
    if (!this.isConfigured()) return null;

    try {
      const res = await fetch(
        `${this.baseUrl}${this.cfg.loginPath ?? "/rest/auth/login"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PrivateKey": this.apiKey as string,
          },
          body: JSON.stringify({
            clientcode: this.clientCode,
            password: this.apiSecret,
            // Sent only when the account enforces 2FA. Upstream expects the
            // current 6-digit RFC 6238 code, never the seed itself — the seed
            // stays server-side and is only ever used to derive this value.
            ...(this.totpSecret ? { totp: generateTotp(this.totpSecret) } : {}),
          }),
          cache: "no-store",
        }
      );
      if (!res.ok) return null;

      const json = (await res.json()) as unknown;
      const token =
        readPath(json, "data.jwtToken") ??
        readPath(json, "data.access_token") ??
        readPath(json, "access_token");

      if (typeof token !== "string" || !token) return null;

      sessionCache.set(this.prefix, { token, fetchedAt: Date.now() });
      return token;
    } catch {
      return null;
    }
  }

  async authedFetch(path: string, init?: RequestInit): Promise<unknown | null> {
    const token = await this.login();
    if (!token) return null;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-PrivateKey": this.apiKey as string,
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        // Token rejected — drop it so the next call re-authenticates rather
        // than looping on a stale session.
        sessionCache.delete(this.prefix);
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}

/**
 * RFC 6238 TOTP: the 6-digit code an authenticator app would show right now,
 * derived from a base32 seed. The seed itself must never be sent anywhere as
 * if it were the code — this function is the only thing that is allowed to
 * touch it, and only to produce a short-lived derived value.
 */
export function generateTotp(
  base32Secret: string,
  { digits = 6, periodSeconds = 30, timestamp = Date.now() }: { digits?: number; periodSeconds?: number; timestamp?: number } = {}
): string {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(timestamp / 1000 / periodSeconds);

  const counterBytes = Buffer.alloc(8);
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", key).update(counterBytes).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binCode % 10 ** digits).padStart(digits, "0");
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.trim().toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Reads a dotted path out of an arbitrary JSON value: "data.priceInfo.ltp",
 * or "1" to index an array. Returns undefined rather than throwing on any
 * missing segment, so a vendor response-shape change degrades to "no data"
 * instead of a 500.
 */
export function readPath(source: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(key);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toIsoOrNow(value: unknown): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === "number") {
    // Broker feeds send either seconds or milliseconds since epoch.
    const ms = value > 1e12 ? value : value * 1000;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/** `YYYY-MM-DD` from anything date-like, or null. Used for option expiries. */
export function toIsoDateOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const direct = /^\d{4}-\d{2}-\d{2}$/.exec(value.trim());
    if (direct) return direct[0];
  }
  if (typeof value === "string" || typeof value === "number") {
    const ms =
      typeof value === "number" ? (value > 1e12 ? value : value * 1000) : value;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/** `YYYY-MM-DD HH:mm` — the format Indian broker candle APIs expect. */
export function formatBrokerDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
