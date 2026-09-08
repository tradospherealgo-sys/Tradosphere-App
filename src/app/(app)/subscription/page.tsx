import {
  getActivePlans,
  getMyEntitlements,
  getMyPayments,
  getMySubscription,
  getMySubscriptionHistory,
} from "@/lib/subscriptions/reads";
import { PlanPicker } from "./plan-picker";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  active: "text-up",
  trialing: "text-accent",
  past_due: "text-warn",
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

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

async function currentTime(): Promise<number> {
  return Date.now();
}

export default async function SubscriptionPage() {
  const [plans, subscription, history, payments, entitlements] = await Promise.all([
    getActivePlans(),
    getMySubscription(),
    getMySubscriptionHistory(),
    getMyPayments(),
    getMyEntitlements(),
  ]);

  // Read the clock once, outside the render path. This page is
  // force-dynamic, so "now" is the request time.
  const now = await currentTime();
  const daysLeft = subscription
    ? Math.ceil(
        (new Date(subscription.current_period_end).getTime() - now) / 86_400_000
      )
    : null;

  const past = history.filter((h) => h.id !== subscription?.id);

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Subscription</h1>
        <p className="text-sm text-text-muted">
          Your plan, entitlements and billing history.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Current plan</h2>
        {!subscription ? (
          <EmptyState
            title="No active subscription"
            body="You have access to the free surfaces. Choose a plan below to unlock signals, the option chain and premium courses."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div>
              <p className="text-xs text-text-faint">Plan</p>
              <p className="mt-1 text-text">{subscription.plans?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-text-faint">Status</p>
              <p
                className={`mt-1 capitalize ${
                  STATUS_STYLES[subscription.status] ?? "text-text"
                }`}
              >
                {subscription.status.replace(/_/g, " ")}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-faint">Renews / expires</p>
              <p className="mt-1 text-text">
                {date(subscription.current_period_end)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-faint">Days remaining</p>
              <p
                className={`mt-1 tabular-nums ${
                  daysLeft !== null && daysLeft <= 7 ? "text-warn" : "text-text"
                }`}
              >
                {daysLeft}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Your entitlements</h2>
        {entitlements.length === 0 ? (
          <p className="text-sm text-text-muted">
            No paid entitlements are active on this account.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {entitlements.map((e) => (
              <li
                key={e}
                className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent"
              >
                {e.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Available plans</h2>
        {plans.length === 0 ? (
          <EmptyState
            title="No plans published"
            body="An admin has not published any subscription plans yet."
          />
        ) : (
          <PlanPicker plans={plans} currentPlanId={subscription?.plan_id ?? null} />
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Billing history</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-text-muted">No payments recorded.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Amount</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Reference</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 text-text-muted">{date(p.created_at)}</td>
                    <td className="py-2 tabular-nums text-text">
                      {money(p.amount_minor, p.currency)}
                    </td>
                    <td className={`py-2 capitalize ${PAYMENT_STYLES[p.status]}`}>
                      {p.status}
                    </td>
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

      {past.length > 0 ? (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-medium text-text">Past subscriptions</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {past.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-2 first:border-0 first:pt-0"
              >
                <span className="text-text">{s.plans?.name ?? "—"}</span>
                <span className="text-text-faint">
                  {date(s.current_period_start)} – {date(s.current_period_end)}
                </span>
                <span className={`capitalize ${STATUS_STYLES[s.status] ?? ""}`}>
                  {s.status.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
