import { NextResponse } from "next/server";
import { ingestTelegramMessage } from "@/lib/signals/ingest";
import { secretsMatch } from "@/lib/security/secrets";

export const dynamic = "force-dynamic";

/**
 * Telegram Bot API webhook.
 *
 * Telegram does not sign its payloads. The only authentication it offers is
 * the secret token you hand it at `setWebhook` time, which it echoes back in
 * `X-Telegram-Bot-Api-Secret-Token` on every delivery. That header is
 * therefore the whole auth boundary here: without a configured secret the
 * endpoint refuses to run at all rather than accepting anonymous posts.
 *
 * Set up (see .env.example and README):
 *   1. TELEGRAM_BOT_TOKEN        — from @BotFather
 *   2. TELEGRAM_WEBHOOK_SECRET   — any long random string you choose
 *   3. curl -F "url=https://<host>/api/telegram/webhook" \
 *           -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
 *           "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
 *   4. Register the channel's chat id as a signal source in
 *      Admin → Signal Desk. Messages from an unregistered chat are stored
 *      and marked `ignored`, never turned into signals.
 *
 * Always answers 200 once authenticated: Telegram retries any non-2xx, and a
 * message we could not parse is a recorded outcome, not a delivery failure.
 */
export async function POST(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Telegram ingestion is not configured on this deployment." },
      { status: 503 }
    );
  }

  const presented = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secretsMatch(presented, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  }

  const message = extractMessage(update);
  if (!message) return NextResponse.json({ ok: true, skipped: "no text message" });

  try {
    const outcome = await ingestTelegramMessage(message);
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    // A 500 makes Telegram redeliver, which is what we want for a transient
    // database failure — the (chat_id, message_id) unique constraint makes
    // the retry idempotent.
    console.error("telegram ingest failed", error);
    return NextResponse.json({ error: "Ingestion failed." }, { status: 500 });
  }
}

type TelegramUpdate = {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

type TelegramMessage = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: { id?: number | string };
  from?: { username?: string; first_name?: string };
  sender_chat?: { title?: string };
};

function extractMessage(update: unknown) {
  const u = update as TelegramUpdate;
  // Edited posts are ignored deliberately: re-reading an edit would create a
  // second signal from the same call. A correction is handled by an admin
  // updating the signal, which leaves a lifecycle event.
  const msg = u?.message ?? u?.channel_post;
  if (!msg) return null;

  const text = msg.text ?? msg.caption;
  const chatId = msg.chat?.id;
  if (!text || chatId === undefined || chatId === null || msg.message_id === undefined) {
    return null;
  }

  return {
    chatId: String(chatId),
    messageId: msg.message_id,
    sender: msg.from?.username ?? msg.from?.first_name ?? msg.sender_chat?.title ?? null,
    text,
    raw: update,
  };
}
