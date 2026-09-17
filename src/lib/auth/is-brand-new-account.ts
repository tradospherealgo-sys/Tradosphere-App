/**
 * Distinguishes a just-created OAuth account from a returning user signing
 * in again, using the same signal Supabase itself exposes: how close
 * `created_at` and `last_sign_in_at` are. Used to gate brand-new Google
 * signups behind an invite code (see src/app/auth/callback/route.ts) without
 * re-checking it on every subsequent login by the same user.
 */
export function isBrandNewAccount(user: {
  created_at: string;
  last_sign_in_at?: string | null;
}): boolean {
  if (!user.last_sign_in_at) return true;
  const created = new Date(user.created_at).getTime();
  const lastSignIn = new Date(user.last_sign_in_at).getTime();
  return Math.abs(lastSignIn - created) < 10_000;
}
