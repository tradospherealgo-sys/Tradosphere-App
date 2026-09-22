import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal fake Supabase query builder: every chain method returns `this`,
// and the object is itself thenable, resolving to the next queued response
// for that table (FIFO, matching the order ingest.ts calls it in). This
// exercises the real ingestTelegramMessage() control flow — source lookup,
// duplicate-by-constraint, parse, duplicate-by-fingerprint, insert, event —
// without a real database.
type Resp = { data: unknown; error: { code?: string; message?: string } | null };

let tableQueues: Record<string, Resp[]>;
let rpcQueue: Resp[];
let rpcCalls: Array<{ name: string; args: unknown }>;

function nextFor(table: string): Resp {
  const q = tableQueues[table];
  return q && q.length > 0 ? q.shift()! : { data: null, error: null };
}

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    eq: () => builder,
    ilike: () => builder,
    limit: () => builder,
    order: () => builder,
    maybeSingle: () => builder,
    single: () => builder,
    then: (resolve: (v: Resp) => void) => resolve(nextFor(table)),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeBuilder(table),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const next = rpcQueue.length > 0 ? rpcQueue.shift()! : { data: null, error: null };
      return { then: (resolve: (v: Resp) => void) => resolve(next) };
    },
  }),
}));

const { ingestTelegramMessage, __testing } = await import("./ingest");
const { categoryForInstrument } = __testing;

const baseMsg = {
  chatId: "-100123",
  messageId: 42,
  sender: "desk_user",
  raw: { update_id: 1 },
};

beforeEach(() => {
  tableQueues = {};
  rpcQueue = [];
  rpcCalls = [];
});

describe("categoryForInstrument", () => {
  it("maps EQUITY to EQUITY", () => {
    expect(categoryForInstrument("EQUITY")).toBe("EQUITY");
  });

  it("maps every option shape the rule-based parser detects to F&O", () => {
    expect(categoryForInstrument("INDEX_OPTION")).toBe("F&O");
    expect(categoryForInstrument("STOCK_OPTION")).toBe("F&O");
  });
});

describe("ingestTelegramMessage", () => {
  it("ignores a message from a chat with no registered signal source", async () => {
    tableQueues = {
      signal_sources: [{ data: null, error: null }],
      telegram_inbox: [{ data: { id: 1 }, error: null }, { data: null, error: null }],
    };
    const outcome = await ingestTelegramMessage({
      ...baseMsg,
      text: "BUY RELIANCE ABOVE 2450 SL 2400 TGT 2500",
    });
    expect(outcome).toEqual({ status: "ignored", reason: "No registered signal source is bound to this chat." });
  });

  it("treats a redelivered (chat_id, message_id) as a no-op duplicate", async () => {
    tableQueues = {
      signal_sources: [{ data: { id: "src1", is_active: true, is_trusted: false, auto_verify: false }, error: null }],
      telegram_inbox: [{ data: null, error: { code: "23505", message: "duplicate key" } }],
    };
    const outcome = await ingestTelegramMessage({ ...baseMsg, text: "BUY RELIANCE ABOVE 2450 SL 2400" });
    expect(outcome).toEqual({ status: "duplicate" });
  });

  it("records a well-formed BUY/SELL message as a valid signal (parsed, not auto-released)", async () => {
    tableQueues = {
      signal_sources: [{ data: { id: "src1", is_active: true, is_trusted: false, auto_verify: false }, error: null }],
      telegram_inbox: [{ data: { id: 1 }, error: null }, { data: null, error: null }],
      signals: [{ data: null, error: null }, { data: { id: "sig-1" }, error: null }],
      signal_events: [{ data: null, error: null }],
    };
    const outcome = await ingestTelegramMessage({
      ...baseMsg,
      text: "BUY RELIANCE ABOVE 2450 SL 2400 TGT 2500 2550",
    });
    expect(outcome).toEqual({ status: "parsed", signalId: "sig-1", released: false });
    expect(rpcCalls).toEqual([]);
  });

  it("auto-releases a parsed signal only when the source is trusted and auto_verify", async () => {
    tableQueues = {
      signal_sources: [{ data: { id: "src1", is_active: true, is_trusted: true, auto_verify: true }, error: null }],
      telegram_inbox: [{ data: { id: 1 }, error: null }, { data: null, error: null }],
      signals: [{ data: null, error: null }, { data: { id: "sig-2" }, error: null }],
      signal_events: [{ data: null, error: null }],
    };
    rpcQueue = [{ data: null, error: null }];
    const outcome = await ingestTelegramMessage({
      ...baseMsg,
      text: "SELL HDFCBANK CMP 1650 SL 1680 T1 1600",
    });
    expect(outcome).toEqual({ status: "parsed", signalId: "sig-2", released: true });
    expect(rpcCalls).toEqual([{ name: "system_release_signal", args: { p_signal_id: "sig-2" } }]);
  });

  it("stores an unparseable/malformed message without inventing a signal", async () => {
    tableQueues = {
      signal_sources: [{ data: { id: "src1", is_active: true, is_trusted: false, auto_verify: false }, error: null }],
      telegram_inbox: [{ data: { id: 1 }, error: null }, { data: null, error: null }],
    };
    const outcome = await ingestTelegramMessage({
      ...baseMsg,
      text: "Good morning everyone, market looks choppy today.",
    });
    expect(outcome.status).toBe("unparseable");
  });

  it("does not create a second signal for the same fingerprint (duplicate call resend)", async () => {
    tableQueues = {
      signal_sources: [{ data: { id: "src1", is_active: true, is_trusted: false, auto_verify: false }, error: null }],
      telegram_inbox: [{ data: { id: 1 }, error: null }, { data: null, error: null }],
      signals: [{ data: { id: "existing-sig" }, error: null }],
    };
    const outcome = await ingestTelegramMessage({
      ...baseMsg,
      text: "BUY RELIANCE ABOVE 2450 SL 2400 TGT 2500",
    });
    expect(outcome).toEqual({ status: "duplicate_signal", signalId: "existing-sig" });
  });

  it("ignores a message from a source that is registered but disabled", async () => {
    tableQueues = {
      signal_sources: [{ data: { id: "src1", is_active: false, is_trusted: false, auto_verify: false }, error: null }],
      telegram_inbox: [{ data: { id: 1 }, error: null }, { data: null, error: null }],
    };
    const outcome = await ingestTelegramMessage({
      ...baseMsg,
      text: "BUY RELIANCE ABOVE 2450 SL 2400",
    });
    expect(outcome).toEqual({ status: "ignored", reason: "Source is registered but disabled." });
  });
});
