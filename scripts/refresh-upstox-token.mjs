#!/usr/bin/env node
/**
 * Daily Upstox access-token refresh helper.
 *
 * Upstox tokens expire every day at 3:30 AM IST and there is no refresh
 * token (see .env.example's Upstox section) — Upstox's own docs state there
 * is no public endpoint for programmatic login, so the browser step cannot
 * be automated away. This script exists to make the *rest* of the daily
 * chore (code → token exchange, updating Vercel, redeploying) a single
 * command instead of five manual ones.
 *
 * Usage:
 *   npm run refresh:upstox-token
 *
 * Requires (read from .env.local, or entered interactively and then
 * cached there for next time):
 *   UPSTOX_API_KEY       — client_id from https://account.upstox.com/developer/apps
 *   UPSTOX_API_SECRET    — client_secret from the same app
 *   UPSTOX_REDIRECT_URI  — must match the app's registered redirect URI exactly
 *
 * Requires the Vercel CLI to be installed and logged in to the account that
 * owns the `tradosphere-app` project (`vercel whoami`).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ENV_LOCAL_PATH = new URL("../.env.local", import.meta.url);

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_LOCAL_PATH, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

/** Sets or replaces a single KEY=value line in .env.local, preserving the rest of the file. */
function upsertEnvLocal(key, value) {
  const lines = existsSync(ENV_LOCAL_PATH)
    ? readFileSync(ENV_LOCAL_PATH, "utf8").split("\n")
    : [];
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  const idx = lines.findIndex((line) => pattern.test(line));
  const newLine = `${key}=${value}`;
  if (idx === -1) {
    lines.push(newLine);
  } else {
    lines[idx] = newLine;
  }
  writeFileSync(ENV_LOCAL_PATH, lines.join("\n"));
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function ask(rl, question) {
  const answer = await rl.question(question);
  return answer.trim();
}

async function main() {
  const env = loadEnvLocal();
  const rl = createInterface({ input: stdin, output: stdout });

  let clientId = env.UPSTOX_API_KEY;
  let clientSecret = env.UPSTOX_API_SECRET;
  let redirectUri = env.UPSTOX_REDIRECT_URI;

  if (!clientId) clientId = await ask(rl, "Upstox API Key (client_id): ");
  if (!clientSecret) clientSecret = await ask(rl, "Upstox API Secret (client_secret): ");
  if (!redirectUri) redirectUri = await ask(rl, "Upstox Redirect URI (must match the app's registered value exactly): ");

  if (!clientId || !clientSecret || !redirectUri) {
    rl.close();
    fail("API key, secret, and redirect URI are all required.");
  }

  // Cache these so future runs only ask for the login step.
  upsertEnvLocal("UPSTOX_API_KEY", clientId);
  upsertEnvLocal("UPSTOX_API_SECRET", clientSecret);
  upsertEnvLocal("UPSTOX_REDIRECT_URI", redirectUri);

  const dialogUrl =
    `https://api.upstox.com/v2/login/authorization/dialog` +
    `?response_type=code&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  console.log("\n1. Open this URL and log in to Upstox (mobile number + PIN + OTP, as usual):\n");
  console.log(`   ${dialogUrl}\n`);
  console.log("2. After login, Upstox redirects to your redirect_uri with ?code=... in the URL.");
  console.log("   That redirect may 404 in your browser (redirect_uri doesn't have to be a live");
  console.log("   page) — that's fine, just copy the URL from the address bar.\n");

  const pasted = await ask(rl, "Paste the redirected URL (or just the code): ");
  rl.close();

  let code = pasted;
  try {
    code = new URL(pasted).searchParams.get("code") ?? pasted;
  } catch {
    // Not a URL — assume the raw code was pasted directly.
  }
  if (!code) fail("No authorization code found in that input.");

  console.log("\nExchanging code for an access token...");
  const tokenRes = await fetch("https://api.upstox.com/v2/login/authorization/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenBody = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !tokenBody?.access_token) {
    fail(`Token exchange failed: ${JSON.stringify(tokenBody ?? { status: tokenRes.status })}`);
  }

  const token = tokenBody.access_token;
  console.log("Got a new access token. It's valid until ~3:30 AM IST tomorrow.");

  upsertEnvLocal("UPSTOX_ACCESS_TOKEN", token);
  console.log("Updated .env.local for local dev.");

  console.log("\nUpdating UPSTOX_ACCESS_TOKEN in Vercel (production)...");
  const set = spawnSync(
    "vercel",
    ["env", "add", "UPSTOX_ACCESS_TOKEN", "production", "--sensitive", "--force", "--value", token],
    { stdio: "inherit" }
  );
  if (set.status !== 0) {
    fail(
      "Could not set the Vercel env var automatically. Set it by hand:\n" +
        "    vercel env add UPSTOX_ACCESS_TOKEN production\n" +
        "  (the new token is already in .env.local if you need to copy it from there)."
    );
  }

  console.log("\nRedeploying production so the new token takes effect...");
  const deploy = spawnSync("vercel", ["deploy", "--prod", "--yes"], { stdio: "inherit" });
  if (deploy.status !== 0) {
    fail("Env var updated, but redeploy failed — run `vercel deploy --prod` by hand to finish.");
  }

  console.log("\nDone. Production is redeploying with the fresh token.");
}

main();
