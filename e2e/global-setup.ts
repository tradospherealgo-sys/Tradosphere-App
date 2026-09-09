import { createClient } from "@supabase/supabase-js";

/**
 * Seeds the backend the authenticated E2E tier runs against.
 *
 * Runs only when E2E_SEED=1 and a service-role key is present, so the suite
 * still behaves as before (public tier runs, authenticated tier self-skips)
 * against any environment that has not opted in. It is never pointed at
 * production: it creates users and rewrites the market-data integration row,
 * which would be destructive on a live project.
 *
 * What it guarantees for the lifecycle spec:
 *  - a confirmed, disposable user whose paper account exists via the
 *    handle_new_user trigger;
 *  - the `test_fixture` market-data provider enabled, so an order has a
 *    deterministic price to fill against (see providers/test-fixture.ts —
 *    the server must also be started with MARKET_DATA_TEST_FIXTURE set);
 *  - a tradable instrument row for the fixture symbol.
 */

export const E2E_SYMBOL = "TESTCO";
export const E2E_FIXTURE_PRICE = 1000;

export default async function globalSetup() {
  if (process.env.E2E_SEED !== "1") return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!url || !serviceKey || !email || !password) {
    throw new Error(
      "E2E_SEED=1 requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_TEST_EMAIL and E2E_TEST_PASSWORD."
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Recreate rather than reuse: a leftover account from a previous run
  // carries positions and a spent cash balance, and the lifecycle
  // assertions are about exact amounts.
  const { data: existing } = await admin.auth.admin.listUsers();
  const previous = existing?.users.find((u) => u.email === email);
  if (previous) await admin.auth.admin.deleteUser(previous.id);

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const { error: instrumentError } = await admin.from("instruments").upsert(
    {
      symbol: E2E_SYMBOL,
      name: "E2E Test Instrument",
      exchange: "NSE",
      instrument_kind: "EQUITY",
      lot_size: 1,
      is_active: true,
    },
    { onConflict: "exchange,symbol" }
  );
  if (instrumentError) throw instrumentError;

  const { error: configError } = await admin.from("integration_configs").upsert(
    {
      id: "market_data_provider",
      provider: "test_fixture",
      is_enabled: true,
      config: {},
    },
    { onConflict: "id" }
  );
  if (configError) throw configError;
}
