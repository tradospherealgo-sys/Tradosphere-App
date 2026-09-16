"use client";

import { useState, useTransition } from "react";
import { startCheckout } from "@/lib/subscriptions/actions";
import type { Plan } from "@/types/database";

const INTERVAL_LABELS: Record<string, string> = {
  monthly: "per month",
  quarterly: "per quarter",
  half_yearly: "per half-year",
  yearly: "per year",
};

function price(plan: Plan): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: plan.currency,
    maximumFractionDigits: 0,
  }).format(plan.price_minor / 100);
}

export function PlanPicker({
  plans,
  currentPlanId,
}: {
  plans: Plan[];
  currentPlanId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  function choose(planId: string) {
    setError(null);
    setReference(null);
    setBusyId(planId);
    startTransition(async () => {
      const result = await startCheckout(planId);
      setBusyId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReference(result.paymentId);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-5 ${
                isCurrent
                  ? "border-accent bg-surface-raised"
                  : "border-border bg-surface"
              }`}
            >
              <p className="text-sm font-medium text-text">{plan.name}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-text">
                {price(plan)}
              </p>
              <p className="text-xs text-text-faint">
                {INTERVAL_LABELS[plan.billing_interval] ?? plan.billing_interval}
              </p>
              {plan.description ? (
                <p className="mt-3 text-sm text-text-muted">{plan.description}</p>
              ) : null}
              {plan.entitlements.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1 text-xs text-text-muted">
                  {plan.entitlements.map((e) => (
                    <li key={e}>• {e.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                onClick={() => choose(plan.id)}
                disabled={pending || isCurrent}
                className="mt-5 min-h-11 rounded-xl bg-accent px-4 text-sm font-medium text-bg disabled:opacity-50"
              >
                {isCurrent
                  ? "Current plan"
                  : busyId === plan.id
                    ? "Preparing…"
                    : "Choose plan"}
              </button>
            </div>
          );
        })}
      </div>

      {error ? <p className="text-sm text-down">{error}</p> : null}

      {reference ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-text-muted">
          <p className="font-medium text-text">Checkout reference {reference}</p>
          <p className="mt-1">
            No payment gateway is connected to this deployment yet, so nothing
            has been charged and your access is unchanged. Quote this reference
            to the desk to have the subscription activated, or ask an admin to
            grant it directly.
          </p>
        </div>
      ) : null}
    </div>
  );
}
