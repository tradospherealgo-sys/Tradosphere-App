"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions backing the login/signup forms. Email/password auth goes
 * straight through Supabase; Google OAuth is kicked off client-side
 * (signInWithOAuth needs to run in the browser to redirect correctly), but
 * the resulting code exchange is handled server-side in
 * src/app/auth/callback/route.ts.
 */

export type AuthActionState = {
  error: string | null;
};

export async function signInWithPassword(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function signUpWithPassword(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }
  if (!inviteCode) {
    return { error: "An invite code is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        ...(fullName ? { full_name: fullName } : {}),
        invite_code: inviteCode,
      },
    },
  });

  if (error) {
    // The handle_new_user() trigger raises this exact message (see
    // supabase/migrations/0026_invite_codes.sql) when redeem_invite_code()
    // fails; Supabase wraps trigger exceptions in a generic "Database error
    // saving new user", so match on our message to give a precise reason.
    if (error.message.includes("A valid invite code is required")) {
      return { error: "That invite code is invalid, expired, or already used." };
    }
    return { error: error.message };
  }

  redirect("/login?checkEmail=1");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
