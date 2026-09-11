import "server-only";
import { timingSafeEqual } from "crypto";

/**
 * Constant-time comparison for shared-secret auth headers (cron bearer
 * token, Telegram webhook secret). A plain `!==` short-circuits on the first
 * mismatched byte, which leaks how many leading characters an attacker
 * guessed correctly through response timing.
 */
export function secretsMatch(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
