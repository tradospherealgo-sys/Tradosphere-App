import "server-only";

/**
 * A raw Postgres/PostgREST error (from a table insert/update/delete) can name
 * tables, columns or constraints in its message — safe to log, not safe to
 * hand to a browser. RPC calls are unaffected: those messages come from our
 * own `RAISE EXCEPTION` text and are written to be user-facing.
 */
export function dbErrorMessage(
  context: string,
  error: { message: string },
  fallback: string
): string {
  console.error(context, error.message);
  return fallback;
}
