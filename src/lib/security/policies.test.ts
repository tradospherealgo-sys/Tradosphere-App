import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Static guard over the database security surface.
 *
 * These are not a substitute for exercising RLS against a live Postgres —
 * they cannot prove a policy *works*. What they do prove is that the grants
 * and revokes the platform's threat model depends on are still present in
 * the migrations, which is the failure mode that actually happens: someone
 * relaxes a policy to unblock a feature and nothing visibly breaks, because
 * the hole only shows up when an attacker uses the public anon key directly.
 *
 * Audit defect S-1 was exactly that shape — clients could write their own
 * financial rows. Each assertion below names the invariant it protects.
 */

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");

function sql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

const ALL = sql();

/** Collapses whitespace so a statement split across lines still matches. */
const flat = ALL.replace(/\s+/g, " ");

describe("financial tables are not client-writable", () => {
  // The engine writes these through SECURITY DEFINER functions. A client
  // holding the anon key must not be able to invent a fill, a position, a
  // balance, or a completed payment.
  const lockedTables = [
    "public.orders",
    "public.positions",
    "public.trades",
    "public.payments",
    "public.subscriptions",
  ];

  for (const table of lockedTables) {
    it(`${table} revokes direct writes from anon and authenticated`, () => {
      const revokes = flat.match(
        new RegExp(`revoke [^;]*on ${table.replace(".", "\\.")} from [^;]*;`, "g")
      );
      expect(revokes, `no revoke statement found for ${table}`).toBeTruthy();
      const combined = revokes!.join(" ");
      expect(combined).toContain("authenticated");
      for (const verb of ["insert", "update", "delete"]) {
        expect(combined, `${table} still allows direct ${verb}`).toContain(verb);
      }
    });
  }

  // paper_accounts is the exception, and deliberately so: the owner must be
  // able to change `risk_per_trade_pct`, which is a preference rather than
  // money. INSERT and DELETE are still revoked, and a BEFORE UPDATE trigger
  // rejects any change to a financial column — RLS WITH CHECK cannot see OLD,
  // so the trigger is the only place this can be enforced.
  it("paper_accounts revokes insert and delete but keeps a guarded update", () => {
    expect(flat).toContain(
      "revoke insert, delete on public.paper_accounts from anon, authenticated;"
    );
  });

  it("paper_accounts money columns are protected by a BEFORE UPDATE trigger", () => {
    expect(flat).toContain("create trigger guard_paper_account_financials");
    expect(flat).toContain("before update on public.paper_accounts");

    // The guard must cover every column that represents money or ownership.
    // A new financial column added without extending this check would be
    // silently writable from the browser.
    for (const column of ["cash_balance", "starting_capital", "user_id", "currency"]) {
      expect(flat, `${column} is not covered by the guard`).toMatch(
        new RegExp(`new\\.${column} is distinct from old\\.${column}`)
      );
    }
  });

  it("the trusted-write flag cannot be forged from the browser", () => {
    // The trigger only stands down for writes that set this transaction-local
    // flag, which SECURITY DEFINER functions do. A client speaking PostgREST
    // has no way to run `set_config` on it.
    expect(flat).toContain("tradosphere.trusted_write");
  });
});

describe("system-only functions are unreachable from the browser", () => {
  // Each of these either mints entitlements, books money, or fans out
  // notifications. They must be service_role-only: the anon key is public.
  const serviceRoleOnly = [
    "public.record_payment_success",
    "public.expire_lapsed_subscriptions",
    "public.warn_expiring_subscriptions",
  ];

  for (const fn of serviceRoleOnly) {
    const escaped = fn.replace(".", "\\.");

    it(`${fn} is revoked from anon and authenticated`, () => {
      const revoke = flat.match(new RegExp(`revoke all on function ${escaped}[^;]*;`));
      expect(revoke, `${fn} has no revoke`).toBeTruthy();
      expect(revoke![0]).toContain("authenticated");
      expect(revoke![0]).toContain("anon");
    });

    it(`${fn} is granted only to service_role`, () => {
      const grants = flat.match(
        new RegExp(`grant execute on function ${escaped}[^;]*;`, "g")
      );
      expect(grants, `${fn} has no grant`).toBeTruthy();
      for (const grant of grants!) {
        expect(grant, `${fn} is granted to a browser role`).toContain("service_role");
        expect(grant).not.toMatch(/\bto (anon|authenticated)\b/);
      }
    });
  }
});

describe("the first-admin bootstrap cannot be replayed", () => {
  it("bootstrap_first_admin refuses once an admin exists", () => {
    // Without this check the function is a privilege-escalation primitive:
    // anyone able to reach it could promote themselves at any time.
    expect(flat).toMatch(/v_admin_count > 0/);
    expect(flat).toContain("an admin already exists");
  });

  it("bootstrap_first_admin is not callable by browser roles", () => {
    const revoke = flat.match(
      /revoke all on function public\.bootstrap_first_admin[^;]*;/
    );
    expect(revoke).toBeTruthy();
    expect(revoke![0]).toContain("authenticated");
  });
});

describe("paid surfaces are gated in the database, not just the UI", () => {
  // Hiding a paid page in React is not access control — the anon key can
  // query the table directly. 0013 moved the paywall onto the rows.
  it("signals require a verified state and a signals entitlement", () => {
    expect(flat).toMatch(/create policy signals_read_released on public\.signals/);
    expect(flat).toMatch(/has_entitlement\('signals'\)/);
  });

  it("option-chain snapshots require an option_chain entitlement", () => {
    expect(flat).toMatch(/has_entitlement\('option_chain'\)/);
  });

  it("lesson access is enforced by can_access_course", () => {
    expect(flat).toContain("can_access_course");
  });
});

describe("row level security is enabled on every user-scoped table", () => {
  const tables = [
    "public.profiles",
    "public.paper_accounts",
    "public.orders",
    "public.positions",
    "public.trades",
    "public.notifications",
    "public.watchlists",
    "public.subscriptions",
    "public.payments",
    "public.signals",
  ];

  for (const table of tables) {
    it(`${table} has RLS enabled`, () => {
      expect(flat).toContain(`alter table ${table} enable row level security`);
    });
  }
});

describe("provider secrets never reach the client", () => {
  it("no NEXT_PUBLIC_ variable carries a provider key or secret", () => {
    const src = path.resolve(__dirname, "../..");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf8");
        for (const match of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
          if (/(SECRET|SERVICE_ROLE|PASSWORD|PRIVATE|API_KEY|TOKEN)/.test(match[0])) {
            offenders.push(`${full}: ${match[0]}`);
          }
        }
      }
    };
    walk(src);

    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });
});
