"use client";

import { useState, useTransition } from "react";
import { Gauge } from "lucide-react";
import { updateIntegrationConfig, testIntegrationConnection } from "@/lib/admin/actions";

type LastTestResult = { ok: boolean; message: string; testedAt: string } | null;

/**
 * Starter config for providers whose shape isn't guessable. The paths and
 * field maps are vendor-specific and expected to be corrected once against
 * the real API response — "Test connection" reports mapping failures
 * separately from auth failures precisely so that loop is short.
 */
const CONFIG_TEMPLATES: Record<string, Record<string, Record<string, unknown>>> = {
  market_data_provider: {
    smc: {
      baseUrl: "https://apiconnect.smcindiaonline.com",
      loginPath: "/rest/auth/login",
      quotePath: "/rest/market/quote?symbol={symbol}&exchange={exchange}",
      candlePath: "/rest/market/candles",
      exchange: "NSE",
      quoteFields: { lastPrice: "data.ltp", prevClose: "data.close" },
      intervalMap: { "5m": "FIVE_MINUTE", "1d": "ONE_DAY" },
    },
    generic_rest: { baseUrl: "https://vendor.example.com/v1" },
  },
  option_chain_provider: {
    smc: {
      baseUrl: "https://apiconnect.smcindiaonline.com",
      loginPath: "/rest/auth/login",
      expiriesPath: "/rest/market/option-expiries?symbol={underlying}",
      chainPath: "/rest/market/option-chain?symbol={underlying}&expiry={expiry}",
      exchange: "NFO",
      layout: "flat",
    },
  },
};

/** Credentials each provider reads from the server environment. */
const REQUIRED_ENV: Record<string, string[]> = {
  smc: ["_API_KEY", "_CLIENT_CODE", "_API_SECRET", "_TOTP_SECRET (optional)"],
  generic_rest: ["<the env var named above>"],
};

export function IntegrationCard({
  id,
  provider,
  isEnabled,
  config,
  secretEnvVar,
  lastTestedAt,
  lastTestResult,
  providerOptions,
}: {
  id: "market_data_provider" | "option_chain_provider";
  provider: string;
  isEnabled: boolean;
  config: Record<string, unknown>;
  secretEnvVar: string | null;
  lastTestedAt: string | null;
  lastTestResult: LastTestResult;
  providerOptions: { value: string; label: string }[];
}) {
  const [providerName, setProviderName] = useState(provider);
  const [enabled, setEnabled] = useState(isEnabled);
  const [configText, setConfigText] = useState(JSON.stringify(config ?? {}, null, 2));
  const [secretVar, setSecretVar] = useState(secretEnvVar ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const template = CONFIG_TEMPLATES[id]?.[providerName];
  const envPrefix = secretVar.trim() || "SMC";
  const requiredEnv = REQUIRED_ENV[providerName];

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-text">
          <Gauge className="size-4 text-accent" aria-hidden />
          {id}
        </h2>
        <span className={enabled ? "text-xs text-up" : "text-xs text-text-faint"}>
          {enabled ? "enabled" : "disabled"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-text-faint">Provider</label>
          <select
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          >
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-faint">
            Secret env var name (never the value itself)
          </label>
          <input
            value={secretVar}
            onChange={(e) => setSecretVar(e.target.value)}
            placeholder="e.g. VENDOR_API_KEY"
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text"
          />
        </div>
      </div>

      {requiredEnv && (
        <p className="mt-3 rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text-muted">
          Set these server-side (they are never stored here or sent to the
          browser):{" "}
          <span className="font-mono text-text">
            {requiredEnv
              .map((suffix) => (suffix.startsWith("_") ? `${envPrefix}${suffix}` : suffix))
              .join(", ")}
          </span>
        </p>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <label className="block text-xs text-text-faint">
            Config (JSON, non-secret — e.g. baseUrl)
          </label>
          {template && (
            <button
              type="button"
              onClick={() => setConfigText(JSON.stringify(template, null, 2))}
              className="text-xs text-accent hover:text-accent-strong"
            >
              Load {providerName} template
            </button>
          )}
        </div>
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text"
        />
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-text-muted">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>

      {message && (
        <p className={`mt-3 text-xs ${message.ok ? "text-up" : "text-down"}`}>{message.text}</p>
      )}

      {lastTestedAt && (
        <p className="mt-2 text-xs text-text-faint">
          Last tested {new Date(lastTestedAt).toLocaleString("en-IN")}:{" "}
          {lastTestResult?.ok ? "OK" : "FAILED"} — {lastTestResult?.message}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              let parsedConfig: Record<string, unknown>;
              try {
                parsedConfig = JSON.parse(configText);
              } catch {
                setMessage({ ok: false, text: "Config must be valid JSON." });
                return;
              }
              const res = await updateIntegrationConfig({
                id,
                provider: providerName,
                isEnabled: enabled,
                config: parsedConfig,
                secretEnvVar: secretVar.trim() || null,
              });
              setMessage(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
            })
          }
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          Save
        </button>
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await testIntegrationConnection(id);
              setMessage(
                res.ok
                  ? { ok: true, text: res.message ?? "Connection OK." }
                  : { ok: false, text: res.error }
              );
            })
          }
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent-strong disabled:opacity-50"
        >
          Test connection
        </button>
      </div>
    </div>
  );
}
