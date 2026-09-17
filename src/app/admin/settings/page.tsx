import { Settings } from "lucide-react";
import { getSystemSettings } from "@/lib/admin/reads";
import { EmptyState } from "@/components/empty-state";
import { SettingRow } from "./setting-row";

export default async function AdminSettingsPage() {
  const settings = await getSystemSettings();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Settings className="size-5 text-accent" aria-hidden />
          System Settings
        </h1>
        <p className="text-sm text-text-muted">
          Global config, stored as JSON values. Changes take effect immediately.
        </p>
      </header>

      {settings.length === 0 ? (
        <EmptyState title="No settings found" />
      ) : (
        <div className="space-y-3">
          {settings.map((s) => (
            <SettingRow key={s.key} settingKey={s.key} value={s.value} description={s.description} />
          ))}
        </div>
      )}
    </div>
  );
}
