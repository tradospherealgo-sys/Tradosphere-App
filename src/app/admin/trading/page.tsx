import {
  getAllPaperAccounts,
  getOpenPositions,
  getRecentOrders,
} from "@/lib/admin/trading-reads";

export const dynamic = "force-dynamic";

const ORDER_STATUS_STYLES: Record<string, string> = {
  FILLED: "text-up",
  PENDING: "text-warn",
  REJECTED: "text-down",
  CANCELLED: "text-text-faint",
};

function date(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

export default async function AdminTradingPage() {
  const [orders, positions, accounts] = await Promise.all([
    getRecentOrders(50),
    getOpenPositions(100),
    getAllPaperAccounts(),
  ]);

  const totalCash = accounts.reduce((sum, a) => sum + Number(a.cash_balance), 0);
  const rejectedCount = orders.filter((o) => o.status === "REJECTED").length;

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <h1 className="text-xl font-semibold text-text">Paper Trading</h1>
        <p className="text-sm text-text-muted">
          Read-only visibility into the simulated trading engine. Every order
          here went through <code className="text-xs">place_paper_order</code>{" "}
          — there is no live-broker path anywhere in this system.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Paper accounts</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {accounts.length}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Open positions</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            {positions.length}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Total cash (sim.)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
            ₹{money(totalCash)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs text-text-faint">Rejected orders (last 50)</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${rejectedCount > 0 ? "text-warn" : "text-text"}`}>
            {rejectedCount}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Recent orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-text-muted">No orders placed yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="pb-2 font-normal">Client</th>
                  <th className="pb-2 font-normal">Symbol</th>
                  <th className="pb-2 font-normal">Side</th>
                  <th className="pb-2 font-normal">Qty</th>
                  <th className="pb-2 font-normal">Price</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Placed</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="py-2 text-text">
                      {o.profiles?.full_name ?? o.profiles?.email ?? "—"}
                    </td>
                    <td className="py-2 font-mono text-xs text-text">{o.symbol}</td>
                    <td className={`py-2 ${o.side === "BUY" ? "text-up" : "text-down"}`}>
                      {o.side}
                    </td>
                    <td className="py-2 tabular-nums text-text-muted">{o.quantity}</td>
                    <td className="py-2 tabular-nums text-text-muted">
                      {money(Number(o.price))}
                    </td>
                    <td className={`py-2 ${ORDER_STATUS_STYLES[o.status] ?? ""}`}>
                      {o.status}
                      {o.reject_reason ? (
                        <span className="ml-1 text-xs text-text-faint">
                          ({o.reject_reason})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs text-text-faint">{date(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Open positions</h2>
        {positions.length === 0 ? (
          <p className="text-sm text-text-muted">No open positions.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="pb-2 font-normal">Client</th>
                  <th className="pb-2 font-normal">Symbol</th>
                  <th className="pb-2 font-normal">Side</th>
                  <th className="pb-2 font-normal">Qty</th>
                  <th className="pb-2 font-normal">Avg price</th>
                  <th className="pb-2 font-normal">Opened</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 text-text">
                      {p.profiles?.full_name ?? p.profiles?.email ?? "—"}
                    </td>
                    <td className="py-2 font-mono text-xs text-text">{p.symbol}</td>
                    <td className={`py-2 ${p.side === "BUY" ? "text-up" : "text-down"}`}>
                      {p.side}
                    </td>
                    <td className="py-2 tabular-nums text-text-muted">{p.quantity}</td>
                    <td className="py-2 tabular-nums text-text-muted">
                      {money(Number(p.avg_price))}
                    </td>
                    <td className="py-2 text-xs text-text-faint">{date(p.opened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-medium text-text">Account balances</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-text-muted">No paper accounts exist yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-text-faint">
                  <th className="pb-2 font-normal">Client</th>
                  <th className="pb-2 font-normal">Starting capital</th>
                  <th className="pb-2 font-normal">Cash balance</th>
                  <th className="pb-2 font-normal">Risk / trade</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2 text-text">
                      {a.profiles?.full_name ?? a.profiles?.email ?? "—"}
                    </td>
                    <td className="py-2 tabular-nums text-text-muted">
                      ₹{money(Number(a.starting_capital))}
                    </td>
                    <td className="py-2 tabular-nums text-text">
                      ₹{money(Number(a.cash_balance))}
                    </td>
                    <td className="py-2 tabular-nums text-text-muted">
                      {a.risk_per_trade_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
