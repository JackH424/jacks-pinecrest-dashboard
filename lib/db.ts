import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Lazy init: neon() throws if DATABASE_URL is unset, and Next evaluates module
// code at build time. Returning null when unset lets the app fall back to the
// seed file until Neon is connected via the Vercel Marketplace.
let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> | null {
  if (!process.env.DATABASE_URL) return null;
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

export function dbConnected(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
