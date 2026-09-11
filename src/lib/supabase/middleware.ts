import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

/**
 * Refreshes the Supabase auth session on every request and enforces two
 * route boundaries:
 *   - /admin/**        requires profiles.role = 'admin'
 *   - everything else under the app's authenticated group requires a
 *     logged-in session (handled by redirecting to /login)
 *
 * This runs in the Edge middleware, so it uses the anon key + cookies only
 * (never the service-role key).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Not configured yet — let requests through; pages will render a
    // clear "Supabase not configured" state rather than crashing here.
    return response;
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const path = request.nextUrl.pathname;

  // Every route under /api/** implements its own auth boundary (a shared
  // webhook/cron secret, or requireUser() returning a proper JSON 401) and
  // expects to be reachable without a browser session cookie — Telegram and
  // a cron scheduler have neither. Redirecting them to /login here would
  // return an HTML page in place of the JSON response those callers expect,
  // which breaks every one of them regardless of how correct their own
  // auth check is. Session refresh/admin gating below is for page routes.
  if (path.startsWith("/api/")) {
    return response;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/auth") ||
    path === "/" ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon");

  if (!user && !isPublic) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  if (path.startsWith("/admin")) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin" || !profile.is_active) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}
