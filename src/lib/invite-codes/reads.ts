import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import type { InviteCode } from "@/types/database";

export async function getAllInviteCodes(): Promise<InviteCode[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("invite_codes")
    .select("*")
    .order("created_at", { ascending: false });
  return data ?? [];
}
