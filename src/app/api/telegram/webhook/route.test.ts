import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ingestMock = vi.fn();
vi.mock("@/lib/signals/ingest", () => ({
  ingestTelegramMessage: (...args: unknown[]) => ingestMock(...args),
}));

const { POST } = await import("./route");

const SECRET = "test-webhook-secret";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/telegram/webhook", () => {
  beforeEach(() => {
    ingestMock.mockReset();
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it("returns 503 when the deployment has no webhook secret configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const res = await POST(req({ update_id: 1 }, { "x-telegram-bot-api-secret-token": "anything" }));
    expect(res.status).toBe(503);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no secret token (401)", async () => {
    const res = await POST(req({ update_id: 1 }));
    expect(res.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret token (401)", async () => {
    const res = await POST(req({ update_id: 1 }, { "x-telegram-bot-api-secret-token": "wrong" }));
    expect(res.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("returns 400 on malformed JSON", async () => {
    const badReq = new Request("https://example.com/api/telegram/webhook", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SECRET, "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });

  it("skips (200) an update with no message/channel_post rather than erroring", async () => {
    const res = await POST(req({ update_id: 1 }, { "x-telegram-bot-api-secret-token": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBeTruthy();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("skips (200) a message missing required fields (chat id / message id / text) without guessing", async () => {
    const res = await POST(
      req({ message: { text: "BUY RELIANCE" } }, { "x-telegram-bot-api-secret-token": SECRET })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBeTruthy();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("ingests a well-formed message and echoes the outcome", async () => {
    ingestMock.mockResolvedValue({ status: "parsed", signalId: "sig-1", released: false });
    const res = await POST(
      req(
        {
          message: {
            message_id: 5,
            text: "BUY RELIANCE ABOVE 2450 SL 2400",
            chat: { id: -100123 },
            from: { username: "desk" },
          },
        },
        { "x-telegram-bot-api-secret-token": SECRET }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toEqual({ status: "parsed", signalId: "sig-1", released: false });
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "-100123", messageId: 5, text: "BUY RELIANCE ABOVE 2450 SL 2400" })
    );
  });

  it("returns 500 (triggering a Telegram redelivery) when ingestion throws", async () => {
    ingestMock.mockRejectedValue(new Error("db unreachable"));
    const res = await POST(
      req(
        {
          message: {
            message_id: 6,
            text: "BUY TCS ABOVE 3900 SL 3850",
            chat: { id: -100123 },
          },
        },
        { "x-telegram-bot-api-secret-token": SECRET }
      )
    );
    expect(res.status).toBe(500);
  });
});
