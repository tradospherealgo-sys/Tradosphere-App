// Authorized Telegram client (MTProto) ingestion worker — Mission 7 Option B.
//
// Runs as its own always-on process (NOT on Vercel — a persistent MTProto
// socket needs a long-lived process, which serverless functions cannot be).
// Deploy it alongside your self-hosted n8n instance (same Docker host,
// Railway, Render, or a VPS — wherever n8n itself already lives per
// n8n/README.md step 1).
//
// It logs in as the Telegram account that is already a legitimate member of
// the 5 premium SMC channels (that's what makes this "authorized" rather
// than scraping — the account holder was let in as a paying subscriber), and
// simply relays new messages from those specific chats to the n8n webhook.
// It never joins, scrapes, or reads any chat outside DEFAULT_CHAT_IDS, and it
// performs no writes back to Telegram at all.
import "dotenv/config";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "teleproto/events/index.js";

// The 5 source channels from the Mission 7 spec. Override via
// TELEGRAM_CHAT_IDS only if the source list itself changes — this is
// deliberately not admin-configurable at runtime, since adding a chat here
// is an authorization decision, not a config toggle.
const DEFAULT_CHAT_IDS = [
  "-1002902210804", // PREMIUM SENSEX360 BY Nitin Murarka (SMC)
  "-1002766156703", // PREMIUM TechnoFunda Calls by SMC
  "-1002739828902", // PREMIUM Equity Ka Funda by SMC
  "-1002899616041", // PREMIUM Index trading with CA Nitin Murarka (SMC Global)
  "-1002670661233", // PREMIUM Commodity Mantra by SMC
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}

const apiId = Number(requireEnv("TELEGRAM_API_ID"));
const apiHash = requireEnv("TELEGRAM_API_HASH");
const sessionString = requireEnv("TELEGRAM_SESSION_STRING");
const webhookUrl = requireEnv("N8N_WEBHOOK_URL");
const webhookSecret = requireEnv("WEBHOOK_SECRET");
const chatIds = new Set(
  (process.env.TELEGRAM_CHAT_IDS?.split(",").map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_CHAT_IDS
);

type RawSignalMessage = {
  channel: "telegram";
  external_chat_id: string;
  external_message_id: string;
  sender: string | null;
  raw_text: string;
  raw_payload: Record<string, unknown>;
  received_at: string;
  is_test: false;
};

async function forwardToN8n(payload: RawSignalMessage): Promise<void> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signal-Worker-Secret": webhookSecret,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`n8n webhook rejected message ${payload.external_message_id}: HTTP ${res.status}`);
    }
  } catch (err) {
    // Fire-and-forget by design: a transient n8n/network outage should not
    // crash the listener or drop the process. The message is simply not
    // relayed this time; there is no local queue/retry in this worker.
    console.error(`Failed to reach n8n webhook for message ${payload.external_message_id}:`, err);
  }
}

async function main() {
  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  const me = await client.getMe();
  console.log(`Connected to Telegram as ${me.username ?? me.id}. Watching ${chatIds.size} channel(s).`);

  client.addEventHandler(async (event: NewMessageEvent) => {
    const message = event.message;
    const chatId = message.chatId?.toString();
    if (!chatId || !chatIds.has(chatId)) return;

    const text = message.message;
    if (!text) return;

    const sender = await message.getSender().catch(() => null);
    const senderName =
      (sender as { username?: string; firstName?: string } | null)?.username ??
      (sender as { username?: string; firstName?: string } | null)?.firstName ??
      null;

    await forwardToN8n({
      channel: "telegram",
      external_chat_id: chatId,
      external_message_id: String(message.id),
      sender: senderName,
      raw_text: text,
      raw_payload: { source: "telegram_mtproto_worker", chatId, messageId: message.id },
      received_at: new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      is_test: false,
    });
  }, new NewMessage({}));

  console.log("Listening for new messages. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});
