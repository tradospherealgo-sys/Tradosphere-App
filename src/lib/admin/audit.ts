import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * There is deliberately no client-facing insert policy on `audit_logs`
 * (see 0002_rls.sql), so appending an entry requires the service-role
 * client. Call this only *after* the underlying mutation has already
 * passed its own RLS-governed write — never as a substitute for one.
 */
export async function writeAuditLog(
  actorId: string,
  action: string,
  targetTable: string,
  targetId?: string
) {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      actor_id: actorId,
      action,
      target_table: targetTable,
      target_id: targetId ?? null,
    });
    // Audit logging must never block the underlying admin action, but a
    // silently dropped entry (e.g. a misconfigured service-role key) should
    // not be invisible either — surface it in server logs so it's caught by
    // whatever aggregates console.error, not just discovered by its absence.
    if (error) {
      console.error("writeAuditLog failed", { action, targetTable, targetId, error });
    }
  } catch (error) {
    console.error("writeAuditLog threw", { action, targetTable, targetId, error });
  }
}
