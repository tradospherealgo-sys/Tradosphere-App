import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. Bypasses RLS entirely — use ONLY inside
 * Route Handlers / Server Actions, and ONLY after you have independently
 * verified the caller's identity and role. Never import this file from
 * a "use client" component (the `server-only` import above makes any
 * such attempt a build-time error).
 *
 * Typical uses: admin role changes, reading/writing provider secrets in
 * `integration_configs`, writing audit_logs, cross-account admin reads.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client is not configured. Set SUPABASE_SERVICE_ROLE_KEY in .env.local (server-side only, see .env.example)."
    );
  }

  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
