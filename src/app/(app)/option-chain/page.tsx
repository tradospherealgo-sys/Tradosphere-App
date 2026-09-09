import { EntitlementGate } from "@/components/entitlement-gate";
import { hasEntitlement } from "@/lib/subscriptions/reads";
import { OptionChainPanel } from "./option-chain-panel";

export const dynamic = "force-dynamic";

export default async function OptionChainPage({
  searchParams,
}: {
  searchParams: Promise<{ underlying?: string }>;
}) {
  // The entitlement check stays server-side. The panel below fetches through
  // /api/market/option-chain, which enforces authentication independently, so
  // hiding the UI is a presentation concern rather than the access control.
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

      <OptionChainPanel initialUnderlying={underlying} />
    </div>
  );
}
