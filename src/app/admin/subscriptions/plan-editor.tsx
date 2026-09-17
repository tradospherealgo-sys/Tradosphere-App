"use client";

import { useState, useTransition } from "react";
import { setPlanActive, upsertPlan } from "@/lib/subscriptions/actions";
import type { BillingInterval, Plan } from "@/types/database";

const INTERVALS: BillingInterval[] = ["monthly", "quarterly", "half_yearly", "yearly"];

const input =
  "min-h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm text-text";
const label = "text-xs text-text-faint";

export function PlanEditor({ plans }: { plans: Plan[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);

  function submit(form: FormData) {
    setError(null);
    const draft = {
      slug: String(form.get("slug") ?? ""),
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      billingInterval: String(form.get("billing_interval") ?? "monthly") as BillingInterval,
      price: String(form.get("price") ?? ""),
      currency: String(form.get("currency") ?? "INR"),
      entitlements: String(form.get("entitlements") ?? ""),
      sortOrder: Number(form.get("sort_order") ?? 0),
    };
    startTransition(async () => {
      const result = await upsertPlan(editing?.id ?? null, draft);
      if (!result.ok) setError(result.error);
      else setEditing(null);
    });
  }

  function toggle(plan: Plan) {
    startTransition(async () => {
      const result = await setPlanActive(plan.id, !plan.is_active);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-raised/40 text-left text-xs uppercase tracking-wide text-text-faint">
              <th className="pb-2 font-normal">Plan</th>
              <th className="pb-2 font-normal">Interval</th>
              <th className="pb-2 font-normal">Price</th>
              <th className="pb-2 font-normal">Entitlements</th>
              <th className="pb-2 font-normal">Active</th>
              <th className="pb-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-border transition-colors hover:bg-surface-raised/30">
                <td className="py-2 text-text">
                  {p.name}
                  <span className="ml-2 font-mono text-xs text-text-faint">{p.slug}</span>
                </td>
                <td className="py-2 text-text-muted">{p.billing_interval.replace("_", " ")}</td>
                <td className="py-2 tabular-nums text-text-muted">
                  {(p.price_minor / 100).toFixed(2)} {p.currency}
                </td>
                <td className="py-2 text-xs text-text-muted">
                  {p.entitlements.join(", ") || "—"}
                </td>
                <td className={`py-2 ${p.is_active ? "text-up" : "text-text-faint"}`}>
                  {p.is_active ? "yes" : "no"}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="mr-3 inline-flex min-h-11 items-center text-xs text-accent"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    disabled={pending}
                    className="inline-flex min-h-11 items-center text-xs text-text-muted disabled:opacity-50"
                  >
                    {p.is_active ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
            {plans.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-text-muted">
                  No plans yet. Create the first one below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Keyed so switching the edit target remounts the uncontrolled inputs
          and their defaultValues actually take effect. */}
      <form
        key={editing?.id ?? "new"}
        action={submit}
        className="flex flex-col gap-3 border-t border-border pt-5"
      >
        <p className="text-sm font-medium text-text">
          {editing ? `Edit “${editing.name}”` : "Create a plan"}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Name</span>
            <input
              name="name"
              required
              defaultValue={editing?.name ?? ""}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Slug</span>
            <input
              name="slug"
              required
              defaultValue={editing?.slug ?? ""}
              placeholder="pro-monthly"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Billing interval</span>
            <select
              name="billing_interval"
              defaultValue={editing?.billing_interval ?? "monthly"}
              className={input}
            >
              {INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {i.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Price (major units)</span>
            <input
              name="price"
              inputMode="decimal"
              required
              defaultValue={editing ? (editing.price_minor / 100).toFixed(2) : ""}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Currency</span>
            <input
              name="currency"
              defaultValue={editing?.currency ?? "INR"}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Sort order</span>
            <input
              name="sort_order"
              type="number"
              defaultValue={editing?.sort_order ?? 0}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={label}>Entitlement keys (comma separated)</span>
            <input
              name="entitlements"
              defaultValue={editing?.entitlements.join(", ") ?? ""}
              placeholder="signals, option_chain, courses"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={label}>Description</span>
            <textarea
              name="description"
              rows={2}
              defaultValue={editing?.description ?? ""}
              className="w-full rounded-xl border border-border bg-surface-raised p-3 text-sm text-text"
            />
          </label>
        </div>
        {error ? <p className="text-sm text-down">{error}</p> : null}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl bg-accent px-5 text-sm font-medium text-bg disabled:opacity-50"
          >
            {editing ? "Save plan" : "Create plan"}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="min-h-11 rounded-xl border border-border px-5 text-sm text-text-muted"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
