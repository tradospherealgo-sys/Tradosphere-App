#!/usr/bin/env node
/**
 * Promotes the first admin on a fresh deployment.
 *
 * A brand-new install has no admin, and every configuration surface —
 * market-data provider, option-chain provider, signal sources, plans — lives
 * under /admin. Without this the deployment is permanently stuck empty
 * (audit defect B-3).
 *
 * The privilege check is in the database, not here: bootstrap_first_admin()
 * refuses once any admin exists, so this cannot be replayed later to escalate
 * an account. This script only carries the service-role key to it.
 *
 * Usage:
 *   npm run bootstrap:admin -- you@example.com
 *
 * Requires in the environment (or .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — server-side only, never in a browser bundle
 *
 * The account must already exist: sign up through the app and confirm the
 * email first, then run this.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadDotEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local is fine — the variables may come from the shell.
  }
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

loadDotEnvLocal();

const email = process.argv[2];
if (!email || !email.includes("@")) {
  fail("Usage: npm run bootstrap:admin -- you@example.com");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
if (!serviceRoleKey) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Find it in Supabase → Project Settings → API → service_role. Keep it out of version control and out of any NEXT_PUBLIC_ variable."
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.rpc("bootstrap_first_admin", {
  p_email: email,
});

if (error) {
  fail(`Bootstrap failed: ${error.message}`);
}

console.log(`\n  ${data?.email ?? email} is now an admin (role=${data?.role}).`);
console.log("  Sign in and open /admin/integrations to configure providers.\n");
