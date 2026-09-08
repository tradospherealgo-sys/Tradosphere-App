import Link from "next/link";
import { hasEntitlement } from "@/lib/subscriptions/reads";

/**
 * Server-side gate for a paid surface.
 *
 * This is a presentation guard, not the security boundary — the real one is
 * RLS on the underlying tables, which uses the same `has_entitlement` check.
 * Hiding the UI without the row policies would only hide the data from
 * honest users, so both layers exist and both consult the database.
 */
export async function EntitlementGate({
  entitlement,
  feature,
  children,
}: {
  entitlement: string;
  feature: string;
  children: React.ReactNode;
}) {
  if (await hasEntitlement(entitlement)) return <>{children}</>;

  return (
    <div className="rounded-2xl border border-dashed border-border bg-bg/40 px-5 py-10 text-center">
      <p className="text-sm font-medium text-text">{feature} needs a subscription</p>
      <p className="mx-auto mt-2 max-w-md text-xs text-text-faint">
        Your current plan does not include the “{entitlement.replace(/_/g, " ")}”
        entitlement. Choose a plan to unlock it.
      </p>
      <Link
        href="/subscription"
        className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-accent px-5 text-sm font-medium text-bg"
      >
        View plans
      </Link>
    </div>
  );
}
