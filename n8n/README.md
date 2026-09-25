# Signal OS — n8n setup checklist

Step-by-step for getting `tradosphere-signal-os-master.json` from "imported" to "green and live." Read the in-file sticky notes ("Read Me", "Credentials Needed") for architecture context — this file is the ordered checklist to actually execute.

## 0. Prerequisites (done already, nothing to do here)

- Migration `0027_signal_os_rpc_wrappers.sql` is pushed to the production Supabase project (`bcjgfdwjmhfgkqglcasu`). The 3 RPC functions it adds (`insert_raw_signal_message`, `check_signal_fingerprint_duplicate`, `mark_raw_message_duplicate`) exist and are `service_role`-only.
- Every database-touching node in the workflow calls Supabase's REST RPC API — no raw Postgres connection is used anywhere.

## 1. Stand up an n8n instance

Self-hosted (Railway, Render, a VPS, Docker) — pick one and get it running with a public HTTPS URL. Telegram/WhatsApp webhooks require a reachable HTTPS endpoint, so `localhost` will not work for the trigger nodes.

## 2. Import the workflow

In n8n: **Workflows → Import from File** → select `n8n/tradosphere-signal-os-master.json`. All 39 nodes should appear; none will be green yet because credentials aren't bound.

## 3. Fill in the "Workflow Config" node (not Settings → Variables)

Settings → Variables/Environments is an Enterprise-only feature on many self-hosted n8n instances, and node expressions can't read `$env`/`process.env` by default (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`) — that setting should stay on rather than be disabled. Neither is needed: none of these 4 values are secrets (the real secret, the `service_role` key, only ever lives in the Supabase credential in step 4). They're plain fields on the **"Workflow Config"** node, sitting right after "Merge All Sources" in the canvas. Open it and set:

| Field | Value |
|---|---|
| `supabaseUrl` | pre-filled with `https://bcjgfdwjmhfgkqglcasu.supabase.co` — leave as-is unless you're pointing at a different Supabase project |
| `telegramChannelId` | chat ID that published signals get posted to |
| `whatsappPhoneNumberId` | only if using WhatsApp distribution |
| `whatsappDistributionNumber` | only if using WhatsApp distribution |

## 4. Create the 4 credentials

Bind each node's credential placeholder (`PLACEHOLDER_SET_ON_IMPORT`) to a real credential:

1. **Supabase API** ("Tradosphere Supabase") — Host = `https://bcjgfdwjmhfgkqglcasu.supabase.co`, Secret Key = the `service_role` key from Supabase → Project Settings → API. **Never** the anon key — RLS would block every write.
2. **Telegram API** — a bot token from a bot that is NOT the app's existing webhook bot (`/api/telegram/webhook` already owns one bot token; Telegram allows only one webhook per token).
3. **WhatsApp Trigger API** + **WhatsApp API** — Meta WhatsApp Business Cloud credentials. Skip and delete the 2 WhatsApp nodes if you're Telegram-only for now.
4. **Groq API key** — from console.groq.com, for the AI Agent's `openai/gpt-oss-120b` model node.

The SMC Auto Trender node stays disabled — no credential needed until you have official API access.

## 5. Register your signal sources in Supabase

Every incoming message is matched against `signal_sources.telegram_chat_id` / `whatsapp_group_id`. Unregistered chats get quarantined (stored, never published) by design. Get each channel's chat ID (add the bot, then check n8n's execution log for the raw `chat.id` on the first message), then insert a row per channel — ask me to write the seed/migration once you have the IDs.

## 6. Activate and test

1. Toggle the workflow to **Active**.
2. Send one real message from a registered Telegram channel.
3. Open the execution log — every node in the path should go green in order: Trigger → Normalize → Merge All Sources → Workflow Config → Insert Raw Message → Source Registered → AI Agent → Parse AI Output → validation → Check Duplicate Fingerprint → Publish Signal → Log Distribution (×3).
4. If any node goes red, open it — the error message names the exact PostgREST/API failure (e.g. a 401 means the wrong Supabase key, a 404 on `/rpc/<fn>` means the migration wasn't applied on this project).

## Known limitations (not bugs)

- WhatsApp Business Cloud API only receives messages sent to your own business number — it cannot read arbitrary community WhatsApp groups you don't administer. The 3 WhatsApp source groups need to relay into that number first; this is a Meta platform constraint.
- SMC Auto Trender node is a placeholder until official API access is granted.
- This workflow is entirely additive — it does not touch or replace the existing single-bot rule-based path at `src/lib/signals/ingest.ts`.

---

# Upstox Token Monitor — n8n setup checklist

Moves the `/api/cron/check-market-data-token` schedule out of Vercel Cron (see `vercel.json`) and into n8n, next to the other Tradosphere workflows. Read the in-file sticky notes in `upstox-token-monitor.json` for the "why" — this is the ordered checklist to actually execute.

1. **Import.** Workflows → Import from File → `n8n/upstox-token-monitor.json`. 2 functional nodes (plus 2 sticky notes): a Schedule Trigger and an HTTP Request node.
2. **Bind the credential.** The HTTP Request node ("Check Upstox Token") needs an HTTP Header Auth credential named `Market Data Cron Auth` — header `Authorization: Bearer <CRON_SECRET>`, using the same `CRON_SECRET` value configured on the Vercel project. Reuse an existing credential of that name if one is already present in this n8n instance; otherwise create it.
3. **Check the timezone.** The workflow's `settings.timezone` is explicitly set to `UTC` so the cron expression `0 3-10 * * 1-5` (weekdays, 03:00–10:00 UTC ≈ 08:30–15:30 IST) fires at the same wall-clock times the Vercel cron did. Don't rely on the n8n instance's default timezone — it may be IST, which would shift every run by 5.5 hours.
4. **Activate and verify manually first.** Toggle the workflow to Active, then trigger "Check Upstox Token" manually (or wait for the next scheduled tick) and confirm a `200` with `{"checked": {...}}` in the execution log — without ever printing the `CRON_SECRET` value anywhere.
5. **Only after that passes**, remove the `/api/cron/check-market-data-token` entry from `vercel.json`'s `crons` array so the check isn't running twice.
