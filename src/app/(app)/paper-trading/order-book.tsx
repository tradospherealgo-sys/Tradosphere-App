"use client";

import { useState, useTransition } from "react";
import { cancelOrder, modifyOrder, processPendingOrders } from "@/lib/trading/actions";
import type { Order } from "@/types/database";

/**
 * Resting-order book.
 *
 * Separated from the filled-order history because the two answer different
 * questions: history is a record, this is a set of live commitments the user
 * can still change. Every button here goes through a SECURITY DEFINER RPC
 * that re-derives ownership from the session — the order id in the DOM is not
 * an authority.
 *
 * "Check for fills" runs the matching pass against real quotes. It exists
 * because there is no background worker in this deployment: without it a
 * resting order would only be re-examined when the user happens to place
 * another one. It can never fill an order the market has not justified — the
 * database re-tests the trigger condition before booking anything.
 */
export function OrderBook({ orders }: { orders: Order[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (orders.length === 0) return null;

  const run = (task: () => Promise<{ ok: boolean; error?: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const res = await task();
      setMessage(
        res.ok
          ? { ok: true, text: "Done." }
          : { ok: false, text: res.error ?? "Action failed." }
      );
      setEditing(null);
    });
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-text">
          Open orders <span className="text-text-faint">({orders.length})</span>
        </h2>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const res = await processPendingOrders();
              setMessage({
                ok: true,
                text:
                  res.filled > 0
                    ? `${res.filled} order${res.filled > 1 ? "s" : ""} filled.`
                    : res.checked === 0
                      ? "No live quotes available for these symbols, so nothing was checked."
                      : "No order met its trigger at the current price.",
              });
            });
          }}
          className="h-11 rounded-full border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-50"
        >
          {pending ? "Checking…" : "Check for fills"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-text-faint">
              <th className="px-4 py-2 font-normal">Symbol</th>
              <th className="px-4 py-2 font-normal">Type</th>
              <th className="px-4 py-2 font-normal">Side</th>
              <th className="px-4 py-2 font-normal">Qty</th>
              <th className="px-4 py-2 font-normal">Limit</th>
              <th className="px-4 py-2 font-normal">Trigger</th>
              <th className="px-4 py-2 font-normal">Blocked cash</th>
              <th className="px-4 py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <Row
                key={order.id}
                order={order}
                editing={editing === order.id}
                pending={pending}
                onEdit={() => setEditing(editing === order.id ? null : order.id)}
                onCancel={() => run(() => cancelOrder(order.id))}
                onSave={(values) => run(() => modifyOrder({ orderId: order.id, ...values }))}
              />
            ))}
          </tbody>
        </table>
      </div>

      {message && (
        <p className={`mt-2 text-xs ${message.ok ? "text-up" : "text-down"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function Row({
  order,
  editing,
  pending,
  onEdit,
  onCancel,
  onSave,
}: {
  order: Order;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (values: {
    quantity: number | null;
    limitPrice: number | null;
    triggerPrice: number | null;
  }) => void;
}) {
  const [quantity, setQuantity] = useState(String(order.quantity));
  const [limitPrice, setLimitPrice] = useState(order.limit_price?.toString() ?? "");
  const [triggerPrice, setTriggerPrice] = useState(order.trigger_price?.toString() ?? "");

  if (editing) {
    return (
      <tr className="border-t border-border bg-bg">
        <td className="px-4 py-2 text-text">{order.symbol}</td>
        <td className="px-4 py-2 text-text-muted">{label(order.variety)}</td>
        <td className={`px-4 py-2 ${order.side === "BUY" ? "text-up" : "text-down"}`}>
          {order.side}
        </td>
        <td className="px-2 py-2">
          <input
            aria-label="Quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="h-9 w-20 rounded-md border border-border bg-surface px-2 text-sm text-text"
          />
        </td>
        <td className="px-2 py-2">
          <input
            aria-label="Limit price"
            value={limitPrice}
            disabled={order.limit_price === null}
            onChange={(e) => setLimitPrice(e.target.value)}
            className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm text-text disabled:opacity-40"
          />
        </td>
        <td className="px-2 py-2">
          <input
            aria-label="Trigger price"
            value={triggerPrice}
            disabled={order.trigger_price === null}
            onChange={(e) => setTriggerPrice(e.target.value)}
            className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm text-text disabled:opacity-40"
          />
        </td>
        <td className="px-4 py-2 text-text-faint">{order.reserved_cash || "—"}</td>
        <td className="px-4 py-2">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                onSave({
                  quantity: toNumber(quantity),
                  limitPrice: order.limit_price === null ? null : toNumber(limitPrice),
                  triggerPrice: order.trigger_price === null ? null : toNumber(triggerPrice),
                })
              }
              className="h-11 rounded-md bg-accent px-3 text-xs font-medium text-bg disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="h-11 rounded-md border border-border px-3 text-xs text-text-muted"
            >
              Cancel
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 text-text">{order.symbol}</td>
      <td className="px-4 py-2 text-text-muted">
        {label(order.variety)} · {order.product}
      </td>
      <td className={`px-4 py-2 ${order.side === "BUY" ? "text-up" : "text-down"}`}>
        {order.side}
      </td>
      <td className="px-4 py-2 text-text-muted">{order.quantity}</td>
      <td className="px-4 py-2 text-text-muted">{order.limit_price ?? "—"}</td>
      <td className="px-4 py-2 text-text-muted">{order.trigger_price ?? "—"}</td>
      <td className="px-4 py-2 text-text-faint">
        {order.reserved_cash ? order.reserved_cash.toLocaleString("en-IN") : "—"}
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="h-11 rounded-md border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-text"
          >
            Modify
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="h-11 rounded-md border border-border px-3 text-xs text-down hover:border-down disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function label(variety: Order["variety"]): string {
  return variety === "SL_M" ? "SL-M" : variety;
}

function toNumber(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
