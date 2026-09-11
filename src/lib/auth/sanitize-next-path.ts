const FALLBACK_PATH = "/dashboard";

/**
 * Only allow same-origin, path-relative redirect targets. Rejects
 * protocol-relative ("//evil.com"), absolute ("https://evil.com"), and
 * backslash-smuggled ("/\evil.com") values so `next` can't be used as an
 * open redirect after auth.
 */
export function sanitizeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return FALLBACK_PATH;
  }
  try {
    const resolved = new URL(next, "http://localhost");
    if (resolved.origin !== "http://localhost") {
      return FALLBACK_PATH;
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return FALLBACK_PATH;
  }
}
