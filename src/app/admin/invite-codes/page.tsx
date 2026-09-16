import { getAllInviteCodes } from "@/lib/invite-codes/reads";
import { InviteCodeEditor } from "./invite-code-editor";

export const dynamic = "force-dynamic";

export default async function AdminInviteCodesPage() {
  const codes = await getAllInviteCodes();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Invite Codes</h1>
        <p className="text-sm text-text-muted">
          Signup is invite-gated. A code must be valid and unused to create an
          account, whether by password or Google — see
          supabase/migrations/0026_invite_codes.sql.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <InviteCodeEditor codes={codes} />
      </section>
    </div>
  );
}
