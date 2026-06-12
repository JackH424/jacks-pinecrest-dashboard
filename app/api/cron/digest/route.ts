import { getSql } from "@/lib/db";
import { TEAM } from "@/lib/team";
import { sendTelegram, telegramEnabled } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Monday-morning cron: per-person summary (open / overdue / done last week /
// stale >10 days). Always posts an in-app System comment on the one-offs
// project @mentioning the person (idempotent per person+day via the id);
// mirrors it as a Telegram DM when the person has registered with the bot.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, error: "no database" });

  const today = new Date().toISOString().slice(0, 10);
  const ymd = today.replace(/-/g, "");
  await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS telegram_chat_id text DEFAULT ''`;

  const rows = (await sql`
    SELECT p.id AS pid, p.name, p.telegram_chat_id,
      COUNT(*) FILTER (WHERE t.status <> 'done') AS open,
      COUNT(*) FILTER (WHERE t.status <> 'done' AND t.due <> '' AND t.due < ${today}) AS overdue,
      COUNT(*) FILTER (WHERE t.status = 'done' AND t.updated_at >= now() - interval '7 days') AS done_week,
      COUNT(*) FILTER (WHERE t.status <> 'done' AND t.updated_at < now() - interval '10 days') AS stale
    FROM people p
    JOIN task_assignees ta ON ta.person_id = p.id
    JOIN tasks2 t ON t.id = ta.task_id
    WHERE p.name = ANY(${TEAM})
    GROUP BY p.id, p.name, p.telegram_chat_id`) as
    { pid: string; name: string; telegram_chat_id: string; open: string; overdue: string; done_week: string; stale: string }[];

  let posted = 0, dms = 0;
  for (const r of rows) {
    const id = `dig-${r.pid}-${ymd}`;
    const body = `Weekly digest: @${r.name} — ${Number(r.open)} open (${Number(r.overdue)} overdue), ` +
      `${Number(r.done_week)} done last week, ${Number(r.stale)} stale (untouched >10 days).`;
    const res = await sql`INSERT INTO comments (id,target_type,target_id,author,body,mentions)
      VALUES (${id}, 'project', 'oneoff', 'System', ${body}, ${JSON.stringify([r.name])}::json)
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if ((res as unknown[]).length) {
      posted++;
      if (telegramEnabled() && r.telegram_chat_id) {
        if (await sendTelegram(r.telegram_chat_id, body.replace(`@${r.name} — `, ""))) dms++;
      }
    }
  }
  return Response.json({ ok: true, people: rows.length, digests_posted: posted, telegram_dms: dms });
}
