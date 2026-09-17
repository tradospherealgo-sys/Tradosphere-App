import { Gauge } from "lucide-react";
import { getIntegrationConfigs } from "@/lib/admin/reads";
import { IntegrationCard } from "./integration-card";

const MARKET_DATA_PROVIDERS = [
  { value: "none", label: "None (no data)" },
  { value: "upstox", label: "Upstox (official API)" },
  { value: "smc", label: "SMC Global (licensed)" },
  { value: "nse_unofficial", label: "NSE (unofficial, dev-grade)" },
  { value: "generic_rest", label: "Generic REST (licensed vendor)" },
];

const OPTION_CHAIN_PROVIDERS = [
  { value: "none", label: "None (no data)" },
  { value: "upstox", label: "Upstox (official API)" },
  { value: "smc", label: "SMC Global (licensed)" },
  { value: "nse_unofficial", label: "NSE (unofficial, dev-grade)" },
];

export default async function AdminIntegrationsPage() {
  const configs = await getIntegrationConfigs();
  const marketData = configs.find((c) => c.id === "market_data_provider");
  const optionChain = configs.find((c) => c.id === "option_chain_provider");

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text">
          <Gauge className="size-5 text-accent" aria-hidden />
          Integrations
        </h1>
        <p className="text-sm text-text-muted">
          These two rows drive every quote, candle, and option-chain snapshot
          in the app. Secrets are referenced by env-var name only — the
          actual value lives in server environment config, never in this
          table or the browser.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {marketData && (
          <IntegrationCard
            id="market_data_provider"
            provider={marketData.provider}
            isEnabled={marketData.is_enabled}
            config={(marketData.config as Record<string, unknown>) ?? {}}
            secretEnvVar={marketData.secret_env_var}
            lastTestedAt={marketData.last_tested_at}
            lastTestResult={
              marketData.last_test_result as
                | { ok: boolean; message: string; testedAt: string }
                | null
            }
            providerOptions={MARKET_DATA_PROVIDERS}
          />
        )}
        {optionChain && (
          <IntegrationCard
            id="option_chain_provider"
            provider={optionChain.provider}
            isEnabled={optionChain.is_enabled}
            config={(optionChain.config as Record<string, unknown>) ?? {}}
            secretEnvVar={optionChain.secret_env_var}
            lastTestedAt={optionChain.last_tested_at}
            lastTestResult={
              optionChain.last_test_result as
                | { ok: boolean; message: string; testedAt: string }
                | null
            }
            providerOptions={OPTION_CHAIN_PROVIDERS}
          />
        )}
      </div>
    </div>
  );
}
