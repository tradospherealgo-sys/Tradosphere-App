import { parseSymbols, requireUser } from "@/lib/api/guard";
import { getActiveMarketDataProvider, getMarketStatus, quoteTtlMs } from "@/lib/market-data";

/**
 * Server-sent quote stream.
 *
 * None of the providers behind the abstraction expose a push socket today, so
 * this polls the cached provider on the session-aware TTL and pushes each
 * result down one long-lived connection. That is a real improvement over the
 * client polling directly — the browser holds one connection instead of N
 * timers, and the shared server-side cache collapses every subscriber onto
 * the same upstream call — and the client contract (an `EventSource` emitting
 * `quotes` events) is exactly what a genuine websocket feed would emit later.
 * Swapping the poll for a push is then a change inside this file.
 *
 * The stream never emits a synthesized tick. If the provider returns nothing,
 * the payload carries an empty `quotes` array and the client keeps showing
 * its last-known value clearly marked stale, rather than being fed a made-up
 * price to keep the number moving.
 */
export const dynamic = "force-dynamic";

/** Hard cap so a forgotten browser tab cannot poll a provider indefinitely. */
const MAX_STREAM_MS = 30 * 60_000;
/** Emitted between quote pushes so proxies do not idle-close the connection. */
const HEARTBEAT_MS = 20_000;

export async function GET(request: Request) {
  const gate = await requireUser();
  if ("response" in gate) return gate.response;

  const symbols = parseSymbols(new URL(request.url).searchParams.get("symbols"));
  if (symbols.length === 0) {
    return new Response("At least one symbol is required.", { status: 400 });
  }

  const provider = await getActiveMarketDataProvider();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;

      // Started before `send` is defined so that `close` can always clear it;
      // the callback only runs a heartbeat interval later, by which point
      // every binding below is initialised.
      const heartbeatTimer = setInterval(() => send("ping", { at: Date.now() }), HEARTBEAT_MS);

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          close();
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(pollTimer);
        clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the client vanished.
        }
      };

      request.signal.addEventListener("abort", close);
      const deadline = Date.now() + MAX_STREAM_MS;

      send("open", {
        configured: provider.isConfigured(),
        provider: provider.name,
        symbols,
      });

      const poll = async () => {
        if (closed) return;
        if (Date.now() > deadline) {
          send("end", { reason: "max-duration" });
          close();
          return;
        }

        try {
          const quotes = await provider.getQuotes(symbols);
          send("quotes", { quotes, status: getMarketStatus(), at: new Date().toISOString() });
        } catch {
          // A provider blowing up is not a reason to drop the connection; the
          // next tick may well succeed. The client sees no new data, which is
          // the honest representation of what just happened.
          send("error", { message: "Quote fetch failed." });
        }

        if (!closed) pollTimer = setTimeout(poll, quoteTtlMs());
      };

      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx-class proxies not to buffer, which would otherwise defeat
      // the whole point by holding events until the response ends.
      "X-Accel-Buffering": "no",
    },
  });
}
