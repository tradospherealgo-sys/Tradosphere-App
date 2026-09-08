import { getIntegrationConfigs } from "@/lib/admin/reads";

function EnvCheck({ label, present }: { label: string; present: boolean }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className={present ? "text-up" : "text-down"}>{present ? "set" : "missing"}</span>
    </li>
  );
}

export default async function AdminHealthPage() {
  const configs = await getIntegrationConfigs();

  const envChecks = [
    { label: "NEXT_PUBLIC_SUPABASE_URL", present: !!process.env.NEXT_PUBLIC_SUPABASE_URL },
    {
      label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      present: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    { label: "SUPABASE_SERVICE_ROLE_KEY", present: !!process.env.SUPABASE_SERVICE_ROLE_KEY },
  ];

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">System Health</h1>
        <p className="text-sm text-text-muted">
          Presence checks only — actual secret values are never displayed
          here or anywhere in the app.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Environment</h2>
        <ul className="space-y-2">
          {envChecks.map((c) => (
            <EnvCheck key={c.label} label={c.label} present={c.present} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-text">Integrations</h2>
        <ul className="space-y-2">
          {configs.map((c) => {
            const result = c.last_test_result as { ok: boolean; message: string } | null;
            return (
              <li key={c.id} className="rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">
                    {c.id} ({c.provider})
                  </span>
                  <span className={c.is_enabled ? "text-up" : "text-text-faint"}>
                    {c.is_enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                {c.last_tested_at ? (
                  <p className="mt-1 text-xs text-text-faint">
                    Last test {new Date(c.last_tested_at).toLocaleString("en-IN")}:{" "}
                    <span className={result?.ok ? "text-up" : "text-down"}>
                      {result?.ok ? "OK" : "FAILED"}
                    </span>{" "}
                    — {result?.message}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-text-faint">Never tested.</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
