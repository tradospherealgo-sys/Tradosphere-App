import { getCurrentUser } from "@/lib/auth/session";
import { getAdminOverviewCounts } from "@/lib/admin/reads";

export default async function AdminOverviewPage() {
  const [{ user }, counts] = await Promise.all([getCurrentUser(), getAdminOverviewCounts()]);

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Admin Control Center</h1>
        <p className="mt-1 text-sm text-text-muted">Signed in as {user?.email}.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs text-text-faint">Total users</p>
          <p className="mt-1 text-2xl font-semibold text-text">{counts.userCount}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs text-text-faint">Total orders placed</p>
          <p className="mt-1 text-2xl font-semibold text-text">{counts.orderCount}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs text-text-faint">Active AI signals</p>
          <p className="mt-1 text-2xl font-semibold text-text">{counts.activeSignalCount}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-text-muted">
        Use the sidebar to manage clients, configure market-data/option-chain
        providers, curate the education library, broadcast notifications,
        edit global settings, and review the audit log.
      </div>
    </div>
  );
}
