import { getActiveOptionChainProvider } from "@/lib/options";
import { calcGreeks, calcMaxPain, calcPcr, daysToExpiry, findAtmStrike } from "@/lib/options/calc";
import { EmptyState } from "@/components/empty-state";
import { EntitlementGate } from "@/components/entitlement-gate";
import { hasEntitlement } from "@/lib/subscriptions/reads";
import { OptionChainTable } from "./option-chain-table";

export const dynamic = "force-dynamic";

const UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

export default async function OptionChainPage({
  searchParams,
}: {
  searchParams: Promise<{ underlying?: string; expiry?: string }>;
}) {
  if (!(await hasEntitlement("option_chain"))) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
        <header>
          <h1 className="text-xl font-semibold text-text">Option Chain</h1>
        </header>
        <EntitlementGate entitlement="option_chain" feature="The option chain">
          {null}
        </EntitlementGate>
      </div>
    );
  }

  const params = await searchParams;
  const underlying = (params.underlying ?? "NIFTY").toUpperCase();

  const provider = await getActiveOptionChainProvider();
  const configured = provider.isConfigured();

  const expiries = configured ? await provider.getExpiries(underlying) : [];
  const expiry = params.expiry && expiries.includes(params.expiry) ? params.expiry : expiries[0];
  const chain = configured && expiry ? await provider.getChain(underlying, expiry) : null;

  const legs = chain?.legs ?? [];
  const spot = chain?.spotAtCapture ?? null;
  const atm = spot !== null ? findAtmStrike(legs, spot) : null;
  const pcr = calcPcr(legs);
  const maxPain = calcMaxPain(legs);

  // Greeks the provider didn't publish are computed here from its own IV and
  // spot. They're labelled "est." in the table so a derived number is never
  // mistaken for an exchange-reported one.
  const tYears = chain ? daysToExpiry(chain.expiry) / 365 : 0;
  const rows = legs.map((leg) => {
    const needsGreeks = leg.delta === null && spot !== null && leg.iv !== null;
    const estimated = needsGreeks
      ? calcGreeks(spot, leg.strike, tYears, leg.iv as number, leg.optionType)
      : null;
    return { leg, estimated };
  });

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Option Chain</h1>
        <p className="mt-1 text-sm text-text-muted">
          Live strikes, open interest and implied volatility from the active
          option-chain provider. Nothing on this page is simulated — if the
          provider is unreachable the chain stays empty rather than showing
          placeholder strikes.
        </p>
      </header>

      <form className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4" method="get">
        <div>
          <label className="block text-xs text-text-faint">Underlying</label>
          <select
            name="underlying"
            defaultValue={underlying}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-text"
          >
            {UNDERLYINGS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-faint">Expiry</label>
          <select
            name="expiry"
            defaultValue={expiry}
            disabled={expiries.length === 0}
            className="mt-1 h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-text disabled:opacity-50"
          >
            {expiries.length === 0 ? (
              <option value="">—</option>
            ) : (
              expiries.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))
            )}
          </select>
        </div>
        <button
          type="submit"
          className="h-11 rounded-lg border border-border px-4 text-sm text-text-muted hover:border-accent hover:text-text"
        >
          Load
        </button>
      </form>

      {!configured ? (
        <EmptyState
          title="No option-chain provider configured"
          body="An admin needs to enable one in Admin → Integrations before the chain can render."
        />
      ) : !chain ? (
        <EmptyState
          title="No chain available"
          body={`The provider returned no mappable legs for ${underlying}${
            expiry ? ` ${expiry}` : ""
          }. It may be outside market hours, or the response mapping needs adjusting in Admin → Integrations.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Spot at capture" value={spot?.toLocaleString("en-IN") ?? "—"} />
            <Metric label="ATM strike" value={atm?.toLocaleString("en-IN") ?? "—"} />
            <Metric label="PCR (OI)" value={pcr?.toFixed(2) ?? "—"} />
            <Metric label="Max pain" value={maxPain?.toLocaleString("en-IN") ?? "—"} />
          </div>

          <OptionChainTable rows={rows} atmStrike={atm} />

          <p className="text-xs text-text-faint">
            Captured {new Date(chain.capturedAt).toLocaleString("en-IN")} from{" "}
            {chain.source}. Greeks marked &ldquo;est.&rdquo; are computed from the
            provider&rsquo;s own IV and spot, not reported by the exchange.
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-text-faint">{label}</p>
      <p className="mt-1 text-lg font-medium text-text">{value}</p>
    </div>
  );
}
