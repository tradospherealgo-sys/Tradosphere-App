import { getAllProfiles } from "@/lib/admin/reads";
import { EmptyState } from "@/components/empty-state";
import { ClientRow } from "./client-row";

export default async function AdminClientsPage() {
  const profiles = await getAllProfiles();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Client Management</h1>
        <p className="text-sm text-text-muted">
          Activate/deactivate accounts and change roles. Role escalation by
          non-admins is blocked at the database level regardless of what the
          client sends.
        </p>
      </header>

      {profiles.length === 0 ? (
        <EmptyState title="No users yet" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-text-faint">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-4 py-2 font-normal">Email</th>
                <th className="px-4 py-2 font-normal">Role</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <ClientRow
                  key={p.id}
                  id={p.id}
                  email={p.email}
                  fullName={p.full_name}
                  role={p.role}
                  isActive={p.is_active}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
