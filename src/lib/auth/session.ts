import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Server-side helper: current authenticated user + their profile row (role,
 * active flag, etc). Returns null for both if not signed in. Use this at
 * the top of Server Components / Route Handlers instead of re-deriving
 * auth state in every page.
 */
export async function getCurrentUser(): Promise<{
  user: { id: string; email: string | null } | null;
  profile: Profile | null;
}> {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    // Supabase env vars aren't set (e.g. local build with no .env.local, or
    // a preview deploy without secrets configured yet). Treat as signed out
    // rather than crashing the page — callers render their own
    // "not configured" state instead.
    return { user: null, profile: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { user: { id: user.id, email: user.email ?? null }, profile: profile ?? null };
}

export async function requireAdmin() {
  const { user, profile } = await getCurrentUser();
  if (!user || !profile || profile.role !== "admin" || !profile.is_active) {
    throw new Error("Forbidden: admin role required.");
  }
  return { user, profile };
}
