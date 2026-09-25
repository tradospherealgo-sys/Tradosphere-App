import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Derives the Supabase project's https/wss origins from the configured URL
 * so CSP `connect-src` targets the real project rather than a blanket
 * `*.supabase.co` (still used as a fallback for local/dev setups where the
 * env var may be a placeholder or unset at config-eval time).
 */
function supabaseConnectSrc(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "https://*.supabase.co wss://*.supabase.co";
  try {
    const { host } = new URL(url);
    return `https://${host} wss://${host}`;
  } catch {
    return "https://*.supabase.co wss://*.supabase.co";
  }
}

/**
 * `upgrade-insecure-requests` makes WebKit rewrite every asset request to
 * https before sending it — harmless on a real https deployment, but on a
 * plain-http origin (local dev, local E2E) there is no TLS listener to
 * upgrade to, so every JS chunk fails with a TLS error and the page never
 * hydrates. NEXT_PUBLIC_SITE_URL is the one env var that states the site's
 * own scheme; default to true (the directive stays on) when it's unset,
 * since that only happens for a real deployment that forgot to set it, not
 * for local http serving (which always sets it explicitly, e.g. e2e-local.sh).
 */
function isHttpsSite(): boolean {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return true;
  }
}

/**
 * No nonce/`proxy.ts` plumbing: that requires forcing every page into
 * dynamic rendering and threading the nonce through `src/proxy.ts`, which
 * also carries the Supabase session refresh and admin route gating — too
 * large a blast radius for this pass. `'unsafe-inline'` on script/style is
 * the documented fallback (Next.js CSP guide, "Without Nonces") and is
 * required here because the App Router streams inline hydration scripts
 * and this codebase uses inline `style={{...}}` throughout.
 */
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' ${supabaseConnectSrc()};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  ${isHttpsSite() ? "upgrade-insecure-requests;" : ""}
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspHeader },
  // Belt-and-braces alongside frame-ancestors above: older browsers that
  // don't parse CSP still get clickjacking protection from this.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
