import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android shell for Tradosphere.
 *
 * This app is server-rendered — server actions, middleware-enforced auth,
 * per-request RLS. None of that survives a static export, so the shell does
 * not bundle the app: it points a native WebView at the deployed
 * Tradosphere host and lets the real backend do the work it already does.
 * The APK therefore ships no Supabase keys, no provider credentials, and no
 * market data. There is nothing in it to extract.
 *
 * The host comes from TRADOSPHERE_APP_URL at sync time rather than being
 * written down here, because an APK built against a placeholder host looks
 * fine until someone installs it. HTTPS is required and cleartext is off:
 * a WebView holding a live session must not be downgradeable.
 */

const appUrl = process.env.TRADOSPHERE_APP_URL;

if (!appUrl) {
  throw new Error(
    "TRADOSPHERE_APP_URL is required — set it to the deployed Tradosphere " +
      "origin (https://...) before running `npx cap sync android`."
  );
}

if (!appUrl.startsWith("https://")) {
  throw new Error(`TRADOSPHERE_APP_URL must be https, got: ${appUrl}`);
}

const config: CapacitorConfig = {
  appId: "com.tradosphere.app",
  appName: "Tradosphere",
  // Only ever shown when the device cannot reach the host. The real UI is
  // served from `server.url`.
  webDir: "android-shell",
  server: {
    url: appUrl,
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
