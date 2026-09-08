import { getMyProfile } from "@/lib/app-data/reads";
import { getMyPaperAccount } from "@/lib/trading/actions";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const [profile, account] = await Promise.all([getMyProfile(), getMyPaperAccount()]);

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Profile & Settings</h1>
        <p className="text-sm text-text-muted">{profile?.email}</p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <SettingsForm
          initialName={profile?.full_name ?? ""}
          initialRiskPct={account?.risk_per_trade_pct ?? 1}
        />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6 text-sm text-text-muted">
        <p>Role: <span className="text-text">{profile?.role ?? "user"}</span></p>
        <p>Account status: <span className="text-text">{profile?.is_active ? "active" : "inactive"}</span></p>
        <p className="mt-2 text-xs text-text-faint">
          This is an educational, simulation-only platform. No real money or
          live broker execution is involved.
        </p>
      </section>
    </div>
  );
}
