import { getSql } from "@/lib/db";

// Cheap change-signature endpoint for the client's "new updates" poller.
// Returns a compact signature of the collaborative state (task/comment/triage
// counts + latest timestamps). When it changes, the client offers a refresh.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const sql = getSql();
  if (!sql) return Response.json({ sig: "nodb" });
  try {
    const r = await sql`SELECT
      (SELECT count(*) FROM tasks2) AS t,
      (SELECT max(updated_at) FROM tasks2) AS mu,
      (SELECT count(*) FROM comments) AS c,
      (SELECT max(created_at) FROM comments) AS mc,
      (SELECT count(*) FROM triage_items WHERE status='pending') AS tr`;
    const row = (r as Record<string, unknown>[])[0] || {};
    return Response.json({ sig: `${row.t}|${row.mu}|${row.c}|${row.mc}|${row.tr}` });
  } catch {
    // triage_items may not exist yet on a fresh DB — fall back to the core tables.
    try {
      const r2 = await sql`SELECT count(*) AS t, max(updated_at) AS mu FROM tasks2`;
      const row = (r2 as Record<string, unknown>[])[0] || {};
      return Response.json({ sig: `${row.t}|${row.mu}` });
    } catch {
      return Response.json({ sig: "err" });
    }
  }
}
