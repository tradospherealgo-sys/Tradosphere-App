import { Info, Settings, UserCircle } from "lucide-react";
import { getMyProfile } from "@/lib/app-data/reads";
import { getMyPaperAccount } from "@/lib/trading/actions";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const [profile, { account }] = await Promise.all([getMyProfile(), getMyPaperAccount()]);

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Settings className="size-5 text-accent" aria-hidden />
          Profile &amp; Settings
        </h1>
        <p className="text-sm text-text-muted">{profile?.email}</p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 flex items-center gap-1.5 text-sm font-medium text-text">
          <UserCircle className="size-4 text-accent" aria-hidden />
          Profile &amp; risk
        </h2>
        <SettingsForm
          initialName={profile?.full_name ?? ""}
          initialRiskPct={account?.risk_per_trade_pct ?? 1}
        />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text">
          <Info className="size-4 text-accent" aria-hidden />
          Account status
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:max-w-xs">
          <div>
            <dt className="text-xs text-text-faint">Role</dt>
            <dd className="mt-0.5 text-text">{profile?.role ?? "user"}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-faint">Status</dt>
            <dd className="mt-0.5">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                  profile?.is_active
                    ? "border-up/40 bg-up/10 text-up"
                    : "border-warn/40 bg-warn/10 text-warn"
                }`}
              >
                {profile?.is_active ? "Active" : "Inactive"}
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-4 text-xs text-text-faint">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This is an educational, simulation-only platform. No real money or
          live broker execution is involved.
        </p>
      </section>
    </div>
  );
}
