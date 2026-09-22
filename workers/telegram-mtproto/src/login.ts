// One-time interactive login. Run this yourself, locally, once:
//
//   npm install
//   npm run login
//
// It will prompt for your phone number, the login code Telegram sends you,
// and your 2FA password if you have one set — all typed directly into your
// own terminal. None of that is sent anywhere except Telegram's own API, and
// none of it is logged or written to disk by this script.
//
// The only thing it prints at the end is a session string. Put that (and
// only that) into your .env as TELEGRAM_SESSION_STRING. It is the
// credential the always-on worker (src/index.ts) uses afterwards so it never
// has to ask for a code again. Guard it like a password — anyone with it is
// logged in as you.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import input from "input";

// Resolve .env relative to this file (not process.cwd()), so `npm run login`
// finds workers/telegram-mtproto/.env regardless of which directory it's
// invoked from.
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const apiIdRaw = process.env.TELEGRAM_API_ID;
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiIdRaw || !apiHash) {
  console.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first (from https://my.telegram.org/apps).");
  process.exit(1);
}

const apiId = Number(apiIdRaw);
if (!Number.isInteger(apiId) || apiId <= 0) {
  console.error(
    "TELEGRAM_API_ID in .env is not a valid number (it must be the numeric app id from https://my.telegram.org/apps — check it isn't still a placeholder)."
  );
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: async () => await input.text("Phone number (with country code): "),
  password: async () => await input.text("2FA password (blank if none): "),
  phoneCode: async () => await input.text("Login code Telegram just sent you: "),
  onError: (err) => console.error(err),
});

console.log("\nLogin successful. Session string (put this in .env as TELEGRAM_SESSION_STRING):\n");
console.log(client.session.save());
console.log("\nDo not paste this anywhere else. Anyone with this string can act as your Telegram account.");

await client.disconnect();
process.exit(0);
