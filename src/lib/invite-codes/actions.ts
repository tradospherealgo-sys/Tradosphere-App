"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/admin/audit";
import { dbErrorMessage } from "@/lib/errors/db-error";

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateInviteCodes() {
  revalidatePath("/admin/invite-codes");
}

export type InviteCodeDraft = {
  code: string;
  note: string;
  maxUses: number;
  expiresAt: string;
};

export async function createInviteCode(draft: InviteCodeDraft): Promise<ActionResult> {
  const { user } = await requireAdmin();

  const code = draft.code.trim();
  if (!code) return { ok: false, error: "Code is required." };
  if (!Number.isFinite(draft.maxUses) || draft.maxUses < 1) {
    return { ok: false, error: "Max uses must be at least 1." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invite_codes")
    .insert({
      code,
      note: draft.note.trim() || null,
      max_uses: Math.floor(draft.maxUses),
      expires_at: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("createInviteCode", error, "Could not create the invite code."),
    };
  }

  await writeAuditLog(user.id, "invite_code.create", "invite_codes", data?.id);
  revalidateInviteCodes();
  return { ok: true };
}

export async function setInviteCodeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { user } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("invite_codes")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) {
    return {
      ok: false,
      error: dbErrorMessage("setInviteCodeActive", error, "Could not update the invite code."),
    };
  }

  await writeAuditLog(
    user.id,
    isActive ? "invite_code.enable" : "invite_code.disable",
    "invite_codes",
    id
  );
  revalidateInviteCodes();
  return { ok: true };
}
