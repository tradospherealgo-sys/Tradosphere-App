#!/usr/bin/env node
/**
 * One-off: creates a local-only admin account for dev access when the
 * existing admins' passwords are unknown. bootstrap_first_admin() refuses
 * once any admin exists (by design), so this instead does what an existing
 * admin's "Admin -> Clients -> promote" action would do, using the
 * service_role exemption documented in 0006_admin_bootstrap.sql: a direct
 * table write authenticated as service_role is the trust boundary the
 * self-escalation trigger is built around, not a way around it.
 *
 * Not wired into package.json — meant to be run once, by hand:
 *   node scripts/create-temp-admin.mjs
 */
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
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
    // No .env.local is fine.
  }
}

loadDotEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `temp-admin+${Date.now()}@tradosphere.local`;
const password = crypto.randomBytes(12).toString("base64url");
const inviteCode = `TEMP-ADMIN-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

const { error: inviteErr } = await supabase.from("invite_codes").insert({
  code: inviteCode,
  note: "one-time — temp admin bootstrap",
  max_uses: 1,
});
if (inviteErr) {
  console.error("Failed to create invite code:", inviteErr.message);
  process.exit(1);
}

const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { invite_code: inviteCode, full_name: "Temp Admin" },
});
if (createErr) {
  console.error("Failed to create user:", createErr.message);
  process.exit(1);
}

const userId = created.user.id;

const { data: profile, error: promoteErr } = await supabase
  .from("profiles")
  .update({ role: "admin", is_active: true })
  .eq("id", userId)
  .select()
  .single();

if (promoteErr) {
  console.error("Failed to promote to admin:", promoteErr.message);
  process.exit(1);
}

console.log("\n  Temporary admin account created:\n");
console.log(`  Email:    ${email}`);
console.log(`  Password: ${password}`);
console.log(`  Role:     ${profile.role}\n`);
console.log("  Sign in at /login, then open /admin.\n");
