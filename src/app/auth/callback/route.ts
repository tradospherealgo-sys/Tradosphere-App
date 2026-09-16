import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeNextPath } from "@/lib/auth/sanitize-next-path";

/**
 * OAuth / magic-link callback. Supabase redirects here with a `code` query
 * param after Google sign-in (or email link); we exchange it for a session
 * cookie and send the user on to their intended destination.
 *
 * Password signup carries its invite code through raw_user_meta_data and is
 * gated by the DB trigger (see supabase/migrations/0026_invite_codes.sql).
 * Google's signInWithOAuth has no equivalent metadata hook, so a brand-new
 * Google account is gated here instead: redeem the code from the `invite`
 * query param (set by GoogleButton on the signup page), and if it doesn't
 * validate, delete the account Supabase just created rather than leave a
 * codeless signup in place.
 */
function isBrandNewAccount(user: { created_at: string; last_sign_in_at?: string | null }) {
  if (!user.last_sign_in_at) return true;
  const created = new Date(user.created_at).getTime();
  const lastSignIn = new Date(user.last_sign_in_at).getTime();
  return Math.abs(lastSignIn - created) < 10_000;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const invite = searchParams.get("invite");
  const next = sanitizeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const user = data.user;
      const provider = user.app_metadata?.provider;

      if (provider === "google" && isBrandNewAccount(user)) {
        const { data: redeemed, error: redeemError } = await supabase.rpc(
          "redeem_invite_code",
          { p_code: invite }
        );

        if (redeemError || !redeemed) {
          await supabase.auth.signOut();
          const admin = createAdminClient();
          await admin.auth.admin.deleteUser(user.id);
          return NextResponse.redirect(
            `${origin}/signup?error=${encodeURIComponent(
              "That invite code is invalid, expired, or already used."
            )}`
          );
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Could not sign you in. Please try again.")}`
  );
}
