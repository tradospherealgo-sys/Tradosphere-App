# Telegram MTProto ingestion worker (Mission 7, Option B)

Why this exists: the 5 real source channels are premium channels Tradosphere
*subscribes to*, not channels it administers. n8n's Telegram Trigger node
uses the Bot API, which can only receive messages from chats a bot has been
added to — the channel owners won't add a third-party bot to a paid channel.
The only legitimate way to ingest these is to authenticate as the Telegram
account that is already a member (Option B: authorized client/API
ingestion), which is exactly what this worker does. It is *not* scraping —
it uses Telegram's own official client protocol (MTProto) with a real,
authorized login, and it only ever reads the 5 specific chats it's told to.

This must run as its own always-on process — never inside the Next.js app
or a Vercel function. Vercel functions are stateless and short-lived; this
worker holds a persistent, long-lived socket to Telegram and needs a host
that stays up. Run it next to your self-hosted n8n instance (same VPS,
same Docker host, Railway, Render — wherever n8n itself lives).

## What Claude built here (code only, no credentials)

- `src/login.ts` — one-time interactive script. **You run this yourself**,
  on your own machine. It asks for your phone number, the login code
  Telegram texts you, and your 2FA password directly in your terminal —
  none of it is ever sent to or seen by Claude. It prints a session string
  at the end.
- `src/index.ts` — the always-on worker. Connects using that session string,
  listens only to the 5 hardcoded chat IDs from the mission spec, and POSTs
  each new message to the n8n `Telegram MTProto In` webhook, header-secret
  protected.
- A matching webhook node was added to `n8n/tradosphere-signal-os-master.json`
  ("Telegram MTProto In"), wired into the existing `Merge All Sources` node
  as a 5th input, so it flows through the exact same
  normalize → AI extraction → validation → dedup → pending review →
  admin approval pipeline as every other source. Nothing about the approval
  gate changes.

## What you need to do manually

### 1. Get API credentials (one-time, free)
Go to <https://my.telegram.org/apps>, log in with the account that is a
member of the 5 channels, create an app. Copy `api_id` and `api_hash` into
this folder's `.env` (copy `.env.example` first). These identify the *app*,
not your account — still don't commit them, but they are not by themselves
enough to log in as you.

### 2. Generate a session string (one-time, interactive, local only)
```
cd workers/telegram-mtproto
npm install
cp .env.example .env
# fill in TELEGRAM_API_ID and TELEGRAM_API_HASH in .env
npm run login
```
Follow the prompts (phone number, the code Telegram sends you, 2FA password
if set) **directly in your own terminal**. Never paste any of this into
Claude or anywhere else. Copy the printed session string into `.env` as
`TELEGRAM_SESSION_STRING`.

### 3. Create the n8n webhook credential
In n8n: **Credentials → New → Header Auth**, name it exactly
`Tradosphere Signal Worker Secret`, header name `X-Signal-Worker-Secret`,
value = any long random string you generate yourself. Put that same value
into this worker's `.env` as `WEBHOOK_SECRET`. Bind it to the
`Telegram MTProto In` node after importing/updating the workflow.

### 4. Set the webhook URL
After importing the workflow into n8n, open the `Telegram MTProto In` node,
copy its **Production URL**, and put it in this worker's `.env` as
`N8N_WEBHOOK_URL`.

### 5. Deploy the worker persistently
Simplest: a Docker container on the same host as n8n.
```
docker build -t tradosphere-telegram-worker workers/telegram-mtproto
docker run -d --restart unless-stopped --env-file workers/telegram-mtproto/.env \
  --name tradosphere-telegram-worker tradosphere-telegram-worker
```
Or run it as a second service in whatever process manager/compose file
already runs your n8n instance. It needs no inbound port — it only makes
outbound connections to Telegram and to your n8n webhook URL.

### 6. Verify
Watch the worker's logs for `Connected to Telegram as ...` and
`Listening for new messages.`. Then have someone post in one of the 5
channels (or wait for a real signal) and check n8n's execution log for the
`Telegram MTProto In` node — it should fire, and the message should flow
through to a `pending` row in `raw_signal_messages` / `signals` exactly like
any other source.

## What this worker deliberately does NOT do

- Does not join, read, or forward any chat other than the 5 configured IDs.
- Does not send messages, react, or take any write action on Telegram.
- Does not store the session string anywhere except your `.env` (gitignored).
- Does not retry/queue on n8n outage — a dropped message during an outage
  is logged and skipped, not silently lost into a hidden queue that could
  replay duplicates later. (Duplicate protection downstream is fingerprint
  -based anyway, per `check_signal_fingerprint_duplicate`.)
