import { ListChecks } from "lucide-react";
import { getAuditLogs } from "@/lib/admin/reads";
import { EmptyState } from "@/components/empty-state";

export default async function AdminAuditLogsPage() {
  const logs = await getAuditLogs();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <ListChecks className="size-5 text-accent" aria-hidden />
          Audit Logs
        </h1>
        <p className="text-sm text-text-muted">
          Written server-side only (service-role client) whenever an admin
          action mutates role/status/integration config/system settings.
        </p>
      </header>

      {logs.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          body="Entries appear here as admin actions are taken across the app."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="px-4 py-2 font-normal">When</th>
                <th className="px-4 py-2 font-normal">Actor</th>
                <th className="px-4 py-2 font-normal">Action</th>
                <th className="px-4 py-2 font-normal">Target</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-border transition-colors hover:bg-surface-raised/30">
                  <td className="px-4 py-2 text-text-faint">
                    {new Date(l.created_at).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{l.actor_id ?? "system"}</td>
                  <td className="px-4 py-2 text-text">{l.action}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {l.target_table ? `${l.target_table}${l.target_id ? `:${l.target_id}` : ""}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
