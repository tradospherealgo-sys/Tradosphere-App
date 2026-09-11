import {
  getAllPayments,
  getAllPlans,
  getAllSubscriptions,
} from "@/lib/subscriptions/reads";
import { getAllProfiles } from "@/lib/admin/reads";
import { PlanEditor } from "./plan-editor";
import { CancelButton, GrantForm, SuspendButton, UnsuspendButton } from "./grant-controls";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  active: "text-up",
  trialing: "text-accent",
  past_due: "text-warn",
  suspended: "text-down",
  expired: "text-text-faint",
  cancelled: "text-text-faint",
};

const PAYMENT_STYLES: Record<string, string> = {
  pending: "text-warn",
  succeeded: "text-up",
  failed: "text-down",
  refunded: "text-text-faint",
};

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminSubscriptionsPage() {
  const [plans, subscriptions, payments, profiles] = await Promise.all([
    getAllPlans(),
    getAllSubscriptions(),
    getAllPayments(),
    getAllProfiles(),
  ]);

  const activePlans = plans.filter((p) => p.is_active);
  const clients = profiles.map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
  }));

  const live = subscriptions.filter(
    (s) =>
      ["trialing", "active", "past_due"].includes(s.status) &&
      new Date(s.current_period_end) > new Date()
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Subscriptions</h1>
        <p className="text-sm text-text-muted">
          Plans, entitlements and access grants. Payments can only be marked
          successful by a verified gateway webhook — never from this console.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Live subscriptions</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {live.length}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Active plans</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {activePlans.length}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Comped</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {live.filter((s) => s.source === "admin_grant").length}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Pending payments</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {payments.filter((p) => p.status === "pending").length}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Grant access</h2>
        <GrantForm plans={activePlans} clients={clients} />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Subscribers</h2>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-text-muted">No subscriptions yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="pb-2 font-normal">Client</th>
                  <th className="pb-2 font-normal">Plan</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Source</th>
                  <th className="pb-2 font-normal">Period end</th>
                  <th className="pb-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => {
                  const cancellable =
                    s.status === "active" ||
                    s.status === "trialing" ||
                    s.status === "past_due";
                  return (
                    <tr key={s.id} className="border-t border-border">
                      <td className="py-2 text-text">
                        {s.profiles?.full_name ?? s.profiles?.email ?? "—"}
                      </td>
                      <td className="py-2 text-text-muted">{s.plans?.name ?? "—"}</td>
                      <td className={`py-2 capitalize ${STATUS_STYLES[s.status] ?? ""}`}>
                        {s.status.replace(/_/g, " ")}
                      </td>
                      <td className="py-2 text-xs text-text-faint">
                        {s.source === "admin_grant" ? "comped" : "paid"}
                      </td>
                      <td className="py-2 text-text-muted">
                        {date(s.current_period_end)}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-3">
                          {s.status === "suspended" ? (
                            <UnsuspendButton subscriptionId={s.id} />
                          ) : cancellable ? (
                            <SuspendButton subscriptionId={s.id} />
                          ) : null}
                          {cancellable ? <CancelButton subscriptionId={s.id} /> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Plans</h2>
        <PlanEditor plans={plans} />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Payment ledger</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-text-muted">No payment attempts recorded.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Amount</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Gateway</th>
                  <th className="pb-2 font-normal">Reference</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 text-text-muted">{date(p.created_at)}</td>
                    <td className="py-2 tabular-nums text-text">
                      {(p.amount_minor / 100).toFixed(2)} {p.currency}
                    </td>
                    <td className={`py-2 capitalize ${PAYMENT_STYLES[p.status]}`}>
                      {p.status}
                    </td>
                    <td className="py-2 text-text-faint">{p.gateway ?? "—"}</td>
                    <td className="py-2 font-mono text-xs text-text-faint">
                      {p.gateway_ref ?? p.id.slice(0, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
