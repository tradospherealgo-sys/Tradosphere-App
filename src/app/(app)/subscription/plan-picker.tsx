"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { startCheckout } from "@/lib/subscriptions/actions";
import type { Plan } from "@/types/database";

const INTERVAL_LABELS: Record<string, string> = {
  monthly: "per month",
  quarterly: "per quarter",
  half_yearly: "per half-year",
  yearly: "per year",
};

// Only used to rank/compare plans that already carry a real price and
// interval — never shown as a price on its own, so there's no new figure
// being invented here, just a derived ordering of existing ones.
const INTERVAL_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

function price(plan: Plan): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: plan.currency,
    maximumFractionDigits: 0,
  }).format(plan.price_minor / 100);
}

function monthlyEquivalentMinor(plan: Plan): number | null {
  const months = INTERVAL_MONTHS[plan.billing_interval];
  return months ? plan.price_minor / months : null;
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

  const monthlyPlan = plans.find((p) => p.billing_interval === "monthly") ?? null;

  // "Best value" is a straight ranking on price-per-month across plans of the
  // same currency — no editorial judgment, just the lowest number.
  const bestValueId =
    plans.length > 1
      ? plans
          .filter((p) => p.currency === plans[0].currency)
          .reduce<{ id: string; value: number } | null>((best, p) => {
            const value = monthlyEquivalentMinor(p);
            if (value === null) return best;
            return !best || value < best.value ? { id: p.id, value } : best;
          }, null)?.id ?? null
      : null;

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
          const isBestValue = plan.id === bestValueId && !isCurrent;
          const equivalent = monthlyEquivalentMinor(plan);
          const monthlyEquivalent =
            monthlyPlan && monthlyPlan.id !== plan.id && equivalent !== null
              ? equivalent
              : null;
          const savingsPct =
            monthlyEquivalent !== null && monthlyPlan!.price_minor > 0
              ? Math.round((1 - monthlyEquivalent / monthlyPlan!.price_minor) * 100)
              : null;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-5 transition-colors ${
                isCurrent
                  ? "border-accent bg-surface-raised ring-1 ring-accent/30"
                  : isBestValue
                    ? "border-accent/50 bg-surface"
                    : "border-border bg-surface hover:border-accent/40"
              }`}
            >
              {isBestValue ? (
                <span className="absolute -top-2.5 left-5 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-bg">
                  Best value
                </span>
              ) : null}
              <p className="text-sm font-medium text-text">{plan.name}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-text">
                {price(plan)}
              </p>
              <p className="text-xs text-text-faint">
                {INTERVAL_LABELS[plan.billing_interval] ?? plan.billing_interval}
              </p>
              {savingsPct !== null && savingsPct > 0 ? (
                <p className="mt-1 text-xs font-medium text-up">
                  Save {savingsPct}% vs. monthly
                </p>
              ) : null}
              {plan.description ? (
                <p className="mt-3 text-sm text-text-muted">{plan.description}</p>
              ) : null}
              {plan.entitlements.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1 text-xs text-text-muted">
                  {plan.entitlements.map((e) => (
                    <li key={e} className="flex items-center gap-1.5">
                      <Check className="size-3.5 shrink-0 text-up" aria-hidden />
                      {e.replace(/_/g, " ")}
                    </li>
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
